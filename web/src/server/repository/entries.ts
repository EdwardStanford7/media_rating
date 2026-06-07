import { orderEntries } from "@/lib/ranking";
import { env } from "cloudflare:workers";
import { NO_IMAGE_KEY, hasStoredImage } from "@/lib/images";
import { assertOwned, first, getDb, newId, now } from "@/server/lib/db";
import { getOwnedCategory } from "./stores/categoryStore";
import {
    getActiveEntryCount,
    getOwnedActiveEntry,
    getOwnedEntry,
    getOwnedEntryWithStatus,
    listActiveEntries,
    rewriteCategoryOrderStatements
} from "./stores/entryStore";
import { markQueuedEntryStarted, queuedEntryStartedStatement } from "./stores/queueStore";
import {
    assertNoActiveBinarySession,
    getActiveSessionRow,
    prepareBinarySession,
    repairInterruptedRankingState
} from "./rankingSessions";

export async function createEntryWithBinaryRanking(
    userId: string,
    input: {
        categoryId: string;
        name: string;
        firstConsumedAt: number | null;
        ignoredQueuedEntryId?: string;
        imageKey?: string | null;
        queuedEntryId?: string;
        queueStartedAt?: number;
    }
) {
    const db = getDb();
    const category = await getOwnedCategory(userId, input.categoryId);
    assertOwned(category, "Category");

    const cleanName = input.name.trim();
    if (!cleanName) {
        throw new Error("Entry name is required");
    }

    await repairInterruptedRankingState(userId);
    const activeSession = await getActiveSessionRow(userId);
    if (activeSession) {
        const activeSubject = await getOwnedEntry(userId, activeSession.subject_entry_id);
        if (
            activeSession.source === "new_entry" &&
            activeSession.category_id === input.categoryId &&
            activeSubject?.name === cleanName
        ) {
            if (input.queuedEntryId) {
                await markQueuedEntryStarted(
                    userId,
                    input.queuedEntryId,
                    input.queueStartedAt ?? now()
                );
            }

            return {
                kind: "session" as const,
                entryId: activeSession.subject_entry_id,
                sessionId: activeSession.id
            };
        }

        throw new Error("Finish or cancel the active ranking before starting another one");
    }

    await assertEntryNameAvailable(userId, input.categoryId, cleanName, input.ignoredQueuedEntryId);

    const activeCount = await getActiveEntryCount(userId, input.categoryId);
    const createdAt = now();
    const entryId = newId("entry");
    const status = activeCount === 0 ? "active" : "ranking";
    const statements = [
        db
            .prepare(
                `INSERT INTO entries (
           id, user_id, category_id, name, rank_position, status, image_key,
           created_at, first_consumed_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
                entryId,
                userId,
                input.categoryId,
                cleanName,
                activeCount,
                status,
                input.imageKey ?? null,
                createdAt,
                input.firstConsumedAt,
                createdAt
            )
    ];

    let sessionId: string | null = null;
    if (activeCount > 0) {
        const session = await prepareBinarySession(db, {
            userId,
            categoryId: input.categoryId,
            subjectEntryId: entryId,
            source: "new_entry",
            opponentCount: activeCount,
            createdAt
        });
        sessionId = session.sessionId;
        statements.push(session.statement);
    }

    if (input.queuedEntryId) {
        statements.push(
            queuedEntryStartedStatement(
                db,
                userId,
                input.queuedEntryId,
                input.queueStartedAt ?? createdAt
            )
        );
    }

    await db.batch(statements);

    if (activeCount === 0) {
        return { kind: "completed" as const, entryId, sessionId: null };
    }

    if (!sessionId) {
        throw new Error("Ranking session was not created");
    }

    return { kind: "session" as const, entryId, sessionId };
}

export async function markImageUnavailable(
    userId: string,
    input: { targetKind: "entry" | "queue"; targetId: string }
) {
    const updatedAt = now();
    const db = getDb();

    if (input.targetKind === "entry") {
        const entry = await first<{ id: string; image_key: string | null }>(
            db
                .prepare(
                    `SELECT id, image_key
         FROM entries
         WHERE id = ? AND user_id = ? AND status != 'deleted'`
                )
                .bind(input.targetId, userId)
        );
        assertOwned(entry, "Entry");

        await db
            .prepare(
                `UPDATE entries
         SET image_key = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status != 'deleted'`
            )
            .bind(NO_IMAGE_KEY, updatedAt, entry.id, userId)
            .run();

        if (hasStoredImage(entry.image_key)) {
            await env.IMAGES.delete(entry.image_key);
        }

        return { imageKey: NO_IMAGE_KEY };
    }

    const queuedEntry = await first<{ id: string; image_key: string | null }>(
        db
            .prepare(
                `SELECT id, image_key
         FROM entry_queue
         WHERE id = ? AND user_id = ? AND status = 'queued'`
            )
            .bind(input.targetId, userId)
    );
    assertOwned(queuedEntry, "Queued entry");

    await db
        .prepare(
            `UPDATE entry_queue
       SET image_key = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'queued'`
        )
        .bind(NO_IMAGE_KEY, updatedAt, queuedEntry.id, userId)
        .run();

    if (hasStoredImage(queuedEntry.image_key)) {
        await env.IMAGES.delete(queuedEntry.image_key);
    }

    return { imageKey: NO_IMAGE_KEY };
}

export async function startRerankEntry(userId: string, entryId: string) {
    const db = getDb();
    await assertNoActiveBinarySession(userId);
    const entry = await getOwnedActiveEntry(userId, entryId);
    assertOwned(entry, "Entry");

    const activeCount = await getActiveEntryCount(userId, entry.categoryId);
    if (activeCount <= 1) {
        return { kind: "completed" as const, entryId, sessionId: null };
    }

    const updatedAt = now();
    const session = await prepareBinarySession(db, {
        userId,
        categoryId: entry.categoryId,
        subjectEntryId: entryId,
        source: "rerank_entry",
        opponentCount: activeCount - 1,
        excludedEntryId: entryId,
        initialRankPosition: entry.rankPosition,
        createdAt: updatedAt
    });
    await db.batch([
        db
            .prepare(
                `UPDATE entries
         SET rank_position = rank_position - 1, updated_at = ?
         WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position > ?`
            )
            .bind(updatedAt, userId, entry.categoryId, entry.rankPosition),
        db
            .prepare(
                `UPDATE entries
         SET status = 'ranking', rank_position = ?, updated_at = ?
         WHERE user_id = ? AND id = ?`
            )
            .bind(activeCount - 1, updatedAt, userId, entryId),
        session.statement
    ]);

    return { kind: "session" as const, entryId, sessionId: session.sessionId };
}

export async function moveEntryRelativeToEntry(
    userId: string,
    input: { entryId: string; targetEntryId: string; placement: "before" | "after" }
) {
    await assertNoActiveBinarySession(userId);
    if (input.entryId === input.targetEntryId) {
        return { moved: false };
    }

    const entry = await getOwnedActiveEntry(userId, input.entryId);
    assertOwned(entry, "Entry");
    const targetEntry = await getOwnedActiveEntry(userId, input.targetEntryId);
    assertOwned(targetEntry, "Target entry");

    if (entry.categoryId !== targetEntry.categoryId) {
        throw new Error("Entries must be in the same category");
    }

    const orderedEntryIds = orderEntries(await listActiveEntries(userId, entry.categoryId))
        .map((candidate) => candidate.id)
        .filter((entryId) => entryId !== entry.id);
    const targetIndex = orderedEntryIds.indexOf(targetEntry.id);
    if (targetIndex === -1) {
        throw new Error("Target entry not found");
    }

    const insertionIndex = input.placement === "after" ? targetIndex + 1 : targetIndex;
    orderedEntryIds.splice(insertionIndex, 0, entry.id);
    const db = getDb();
    await db.batch(rewriteCategoryOrderStatements(db, userId, entry.categoryId, orderedEntryIds, now()));

    return { moved: true };
}

export async function renameEntry(userId: string, entryId: string, name: string) {
    const entry = await getOwnedEntry(userId, entryId);
    assertOwned(entry, "Entry");

    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("Entry name is required");
    }

    const updatedAt = now();
    await getDb()
        .prepare(
            `UPDATE entries
       SET name = ?, updated_at = ?
       WHERE user_id = ? AND id = ? AND status != 'deleted'`
        )
        .bind(cleanName, updatedAt, userId, entryId)
        .run();
}

export async function deleteEntry(userId: string, entryId: string) {
    await assertNoActiveBinarySession(userId);
    const entry = await getOwnedActiveEntry(userId, entryId);
    assertOwned(entry, "Entry");

    const updatedAt = now();
    await getDb()
        .prepare(
            `UPDATE entries
       SET status = 'deleted', updated_at = ?
       WHERE user_id = ? AND id = ?`
        )
        .bind(updatedAt, userId, entryId)
        .run();
    await getDb()
        .prepare(
            `UPDATE entries
       SET rank_position = rank_position - 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position > ?`
        )
        .bind(updatedAt, userId, entry.categoryId, entry.rankPosition)
        .run();
}

export async function restoreEntry(userId: string, entryId: string) {
    await assertNoActiveBinarySession(userId);
    const entry = await getOwnedEntryWithStatus(userId, entryId);
    assertOwned(entry, "Entry");

    if (entry.status === "active") {
        return;
    }

    if (entry.status !== "deleted") {
        throw new Error("Entry cannot be restored");
    }

    const category = await getOwnedCategory(userId, entry.category_id);
    assertOwned(category, "Category");
    await assertEntryNameAvailable(userId, entry.category_id, entry.name);

    const activeEntryCount = await getActiveEntryCount(userId, entry.category_id);
    const restoreRankPosition = Math.max(0, Math.min(entry.rank_position, activeEntryCount));
    const updatedAt = now();
    const db = getDb();

    await db.batch([
        db
            .prepare(
                `UPDATE entries
       SET rank_position = rank_position + 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position >= ?`
            )
            .bind(updatedAt, userId, entry.category_id, restoreRankPosition),
        db
            .prepare(
                `UPDATE entries
       SET status = 'active', rank_position = ?, updated_at = ?
       WHERE user_id = ? AND id = ? AND status = 'deleted'`
            )
            .bind(restoreRankPosition, updatedAt, userId, entryId)
    ]);
}

export async function switchEntryCategory(
    userId: string,
    input: { entryId: string; targetCategoryId: string }
) {
    const db = getDb();
    await assertNoActiveBinarySession(userId);
    const entry = await getOwnedActiveEntry(userId, input.entryId);
    assertOwned(entry, "Entry");
    const targetCategory = await getOwnedCategory(userId, input.targetCategoryId);
    assertOwned(targetCategory, "Target category");

    if (entry.categoryId === input.targetCategoryId) {
        return { kind: "completed" as const, entryId: entry.id, sessionId: null };
    }

    const duplicate = await first<{ id: string }>(
        getDb()
            .prepare(
                `SELECT id
         FROM entries
         WHERE user_id = ? AND category_id = ? AND name = ? AND status != 'deleted' AND id != ?`
            )
            .bind(userId, input.targetCategoryId, entry.name, entry.id)
    );
    if (duplicate) {
        throw new Error("That entry already exists in the target category");
    }

    const targetCount = await getActiveEntryCount(userId, input.targetCategoryId);
    const updatedAt = now();
    const statements: D1PreparedStatement[] = [
        db
            .prepare(
                `UPDATE entries
         SET rank_position = rank_position - 1, updated_at = ?
         WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position > ?`
            )
            .bind(updatedAt, userId, entry.categoryId, entry.rankPosition),
        db
            .prepare(
                `UPDATE entries
         SET category_id = ?, rank_position = ?, status = ?, updated_at = ?
         WHERE user_id = ? AND id = ?`
            )
            .bind(
                input.targetCategoryId,
                targetCount,
                targetCount === 0 ? "active" : "ranking",
                updatedAt,
                userId,
                entry.id
            )
    ];

    if (targetCount === 0) {
        await db.batch(statements);
        return { kind: "completed" as const, entryId: entry.id, sessionId: null };
    }

    const session = await prepareBinarySession(db, {
        userId,
        categoryId: input.targetCategoryId,
        subjectEntryId: entry.id,
        source: "switch_category",
        fromCategoryId: entry.categoryId,
        opponentCount: targetCount,
        createdAt: updatedAt
    });
    statements.push(session.statement);
    await db.batch(statements);

    return { kind: "session" as const, entryId: entry.id, sessionId: session.sessionId };
}

export async function assertEntryNameAvailable(
    userId: string,
    categoryId: string,
    name: string,
    ignoredQueuedEntryId?: string
) {
    await repairInterruptedRankingState(userId);

    const existingEntry = await first<{ id: string }>(
        getDb()
            .prepare(
                `SELECT id
         FROM entries
         WHERE user_id = ? AND category_id = ? AND name = ? AND status != 'deleted'`
            )
            .bind(userId, categoryId, name)
    );
    if (existingEntry) {
        throw new Error("That entry already exists in this category");
    }

    const existingQueuedEntry = await first<{ id: string }>(
        getDb()
            .prepare(
                `SELECT id
         FROM entry_queue
         WHERE user_id = ? AND category_id = ? AND name = ? AND status = 'queued'
           AND (? IS NULL OR id != ?)`
            )
            .bind(userId, categoryId, name, ignoredQueuedEntryId ?? null, ignoredQueuedEntryId ?? null)
    );
    if (existingQueuedEntry) {
        throw new Error("That entry is already queued in this category");
    }
}
