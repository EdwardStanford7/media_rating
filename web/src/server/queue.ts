import { createServerFn } from "@tanstack/react-start";
import type { QueuedEntry } from "@/lib/types";
import { assertOwned, getDb, newId, now } from "@/server/lib/db";
import { authMiddleware } from "@/server/middleware/auth";
import { getOwnedCategory } from "./stores/categoryStore";
import {
    getOwnedQueuedEntry,
    getOwnedQueuedEntryIncludingDeleted,
    getQueueSettings,
    normalizeQueueDelayDays
} from "./stores/queueStore";
import { assertEntryNameAvailable, createEntryWithBinaryRankingForUser } from "./engine/entryCreation";

const DAY_MS = 24 * 60 * 60 * 1000;

export const createQueuedEntry = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { categoryId: string; name: string; createdAt?: number | null; }) => data)
    .handler(async ({ context, data: input }) => {
        const userId = context.user.id;
        const category = await getOwnedCategory(userId, input.categoryId);
        assertOwned(category, "Category");

        const cleanName = input.name.trim();
        if (!cleanName) {
            throw new Error("Entry name is required");
        }

        await assertEntryNameAvailable(userId, input.categoryId, cleanName);

        const settings = await getQueueSettings(userId);
        const updatedAt = now();
        const createdAt = normalizeCreatedAt(input.createdAt) ?? updatedAt;
        const availableAt = updatedAt + settings.delayDays * DAY_MS;
        const queueId = newId("queue");

        await getDb()
            .prepare(
                `INSERT INTO entry_queue (
             id, user_id, category_id, name, available_at,
             status, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`
            )
            .bind(
                queueId,
                userId,
                input.categoryId,
                cleanName,
                availableAt,
                createdAt,
                updatedAt
            )
            .run();

        const queuedEntry: QueuedEntry = {
            id: queueId,
            categoryId: input.categoryId,
            categoryName: category.name,
            name: cleanName,
            imageKey: null,
            availableAt,
            createdAt
        };

        return { queuedEntry, queuedEntryId: queueId, availableAt };
    });

function normalizeCreatedAt(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

export const updateQueueSettings = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: {
        enabled: boolean;
        delayDays: number;
        promptForMissingImages: boolean;
        randomizeReadyEntries: boolean;
    }) => data)
    .handler(async ({ context, data: input }) => {
        const userId = context.user.id;
        const delayDays = normalizeQueueDelayDays(input.delayDays);
        const updatedAt = now();

        await getDb()
            .prepare(
                `INSERT INTO queue_settings (
             user_id, enabled, delay_days, prompt_missing_images, randomize_ready_entries, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             enabled = excluded.enabled,
             delay_days = excluded.delay_days,
             prompt_missing_images = excluded.prompt_missing_images,
             randomize_ready_entries = excluded.randomize_ready_entries,
             updated_at = excluded.updated_at`
            )
            .bind(
                userId,
                input.enabled ? 1 : 0,
                delayDays,
                input.promptForMissingImages ? 1 : 0,
                input.randomizeReadyEntries ? 1 : 0,
                updatedAt,
                updatedAt
            )
            .run();

        return getQueueSettings(userId);
    });

export const startQueuedEntryRanking = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { queuedEntryId: string; overrideDelay?: boolean }) => data)
    .handler(async ({ context, data: input }) => {
        const userId = context.user.id;
        const queuedEntry = await getOwnedQueuedEntry(userId, input.queuedEntryId);
        assertOwned(queuedEntry, "Queued entry");

        const currentTime = now();
        if (queuedEntry.availableAt > currentTime && !input.overrideDelay) {
            throw new Error("This queued entry is not ready to rank yet");
        }

        await assertEntryNameAvailable(userId, queuedEntry.categoryId, queuedEntry.name, queuedEntry.id);

        const result = await createEntryWithBinaryRankingForUser(userId, {
            categoryId: queuedEntry.categoryId,
            name: queuedEntry.name,
            createdAt: queuedEntry.createdAt,
            ignoredQueuedEntryId: queuedEntry.id,
            imageKey: queuedEntry.imageKey,
            queuedEntryId: queuedEntry.id,
            queueStartedAt: currentTime
        });

        return result;
    });

export const deleteQueuedEntry = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { queuedEntryId: string }) => data)
    .handler(async ({ context, data }) => {
        const userId = context.user.id;
        const { queuedEntryId } = data;
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

    });

export const restoreQueuedEntry = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { queuedEntryId: string }) => data)
    .handler(async ({ context, data }) => {
        const userId = context.user.id;
        const { queuedEntryId } = data;
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
    });

export const renameQueuedEntry = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { queuedEntryId: string; name: string }) => data)
    .handler(async ({ context, data }) => {
        const userId = context.user.id;
        const { queuedEntryId, name } = data;
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
    });
