import { assertOwned, getDb, newId, now } from "../db";
import { getOwnedCategory } from "./stores/categoryStore";
import {
    getOwnedQueuedEntry,
    getOwnedQueuedEntryIncludingDeleted,
    getQueueSettings,
    normalizeQueueDelayDays
} from "./stores/queueStore";
import { assertEntryNameAvailable, createEntryWithBinaryRanking } from "./entries";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function createQueuedEntry(
    userId: string,
    input: {
        categoryId: string;
        name: string;
        firstConsumedAt: number | null;
    }
) {
    const category = await getOwnedCategory(userId, input.categoryId);
    assertOwned(category, "Category");

    const cleanName = input.name.trim();
    if (!cleanName) {
        throw new Error("Entry name is required");
    }

    await assertEntryNameAvailable(userId, input.categoryId, cleanName);

    const settings = await getQueueSettings(userId);
    const createdAt = now();
    const availableAt = createdAt + settings.delayDays * DAY_MS;
    const queueId = newId("queue");

    await getDb()
        .prepare(
            `INSERT INTO entry_queue (
         id, user_id, category_id, name, first_consumed_at, available_at,
         status, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
        )
        .bind(
            queueId,
            userId,
            input.categoryId,
            cleanName,
            input.firstConsumedAt,
            availableAt,
            createdAt,
            createdAt
        )
        .run();

    return { queuedEntryId: queueId, availableAt };
}

export async function updateQueueSettings(
    userId: string,
    input: {
        enabled: boolean;
        delayDays: number;
        promptForMissingImages: boolean;
    }
) {
    const delayDays = normalizeQueueDelayDays(input.delayDays);
    const updatedAt = now();

    await getDb()
        .prepare(
            `INSERT INTO queue_settings (
         user_id, enabled, delay_days, prompt_missing_images, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled,
         delay_days = excluded.delay_days,
         prompt_missing_images = excluded.prompt_missing_images,
         updated_at = excluded.updated_at`
        )
        .bind(
            userId,
            input.enabled ? 1 : 0,
            delayDays,
            input.promptForMissingImages ? 1 : 0,
            updatedAt,
            updatedAt
        )
        .run();

    return getQueueSettings(userId);
}

export async function startQueuedEntryRanking(
    userId: string,
    input: { queuedEntryId: string; overrideDelay?: boolean }
) {
    const queuedEntry = await getOwnedQueuedEntry(userId, input.queuedEntryId);
    assertOwned(queuedEntry, "Queued entry");

    const currentTime = now();
    if (queuedEntry.availableAt > currentTime && !input.overrideDelay) {
        throw new Error("This queued entry is not ready to rank yet");
    }

    await assertEntryNameAvailable(userId, queuedEntry.categoryId, queuedEntry.name, queuedEntry.id);

    const result = await createEntryWithBinaryRanking(userId, {
        categoryId: queuedEntry.categoryId,
        name: queuedEntry.name,
        firstConsumedAt: queuedEntry.firstConsumedAt,
        ignoredQueuedEntryId: queuedEntry.id,
        imageKey: queuedEntry.imageKey,
        queuedEntryId: queuedEntry.id,
        queueStartedAt: currentTime
    });

    return result;
}

export async function deleteQueuedEntry(userId: string, queuedEntryId: string) {
    const queuedEntry = await getOwnedQueuedEntry(userId, queuedEntryId);
    assertOwned(queuedEntry, "Queued entry");

    const updatedAt = now();
    await getDb()
        .prepare(
            `UPDATE entry_queue
       SET status = 'deleted', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'queued'`
        )
        .bind(updatedAt, queuedEntryId, userId)
        .run();

}

export async function restoreQueuedEntry(userId: string, queuedEntryId: string) {
    const queuedEntry = await getOwnedQueuedEntryIncludingDeleted(userId, queuedEntryId);
    assertOwned(queuedEntry, "Queued entry");

    if (queuedEntry.status === "queued") {
        return;
    }

    if (queuedEntry.status !== "deleted") {
        throw new Error("Queued entry cannot be restored");
    }

    await assertEntryNameAvailable(userId, queuedEntry.category_id, queuedEntry.name, queuedEntry.id);
    const updatedAt = now();

    await getDb()
        .prepare(
            `UPDATE entry_queue
       SET status = 'queued', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'deleted'`
        )
        .bind(updatedAt, queuedEntryId, userId)
        .run();
}

export async function renameQueuedEntry(userId: string, queuedEntryId: string, name: string) {
    const queuedEntry = await getOwnedQueuedEntry(userId, queuedEntryId);
    assertOwned(queuedEntry, "Queued entry");

    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("Entry name is required");
    }

    await assertEntryNameAvailable(userId, queuedEntry.categoryId, cleanName, queuedEntry.id);

    const updatedAt = now();
    await getDb()
        .prepare(
            `UPDATE entry_queue
       SET name = ?, updated_at = ?
       WHERE user_id = ? AND id = ? AND status = 'queued'`
        )
        .bind(cleanName, updatedAt, userId, queuedEntryId)
        .run();
}
