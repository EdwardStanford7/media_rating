import {
    type BubbleRepairState,
    type RankingComparison,
    type RandomAuditBubbleState,
    advanceBubbleRepairState,
    advanceRandomAuditBubbleState,
    chooseBinaryPivot,
    normalizeStarRatingCurve,
    orderEntries,
    startBubbleRepairState,
    startRandomAuditBubbleState
} from "@/lib/ranking";
import type {
    ActiveBinarySession,
    BinarySessionView,
    CategoryWithEntries,
    DashboardData,
    Entry,
    ParsedImport,
    QueuedEntry,
    QueueSettings,
    RankingOperationKind,
    RankingSource
} from "@/lib/types";
import { env } from "cloudflare:workers";
import { NO_IMAGE_KEY, hasStoredImage } from "@/lib/images";
import { all, assertOwned, first, getDb, newId, now } from "./db";

interface CategoryRow {
    id: string;
    name: string;
    sort_order: number;
    created_at: number;
    star_rating_curve?: string | null;
}

interface EntryRow {
    id: string;
    category_id: string;
    name: string;
    rank_position: number;
    image_key: string | null;
    created_at: number;
    first_consumed_at: number | null;
}

interface ExistingEntryRow {
    category_id: string;
    name: string;
    status: string;
}

interface QueueSettingsRow {
    enabled: number;
    delay_days: number;
    prompt_missing_images: number;
    show_star_ratings: number;
    star_rating_curve: string | null;
}

interface QueuedEntryRow {
    id: string;
    category_id: string;
    category_name: string;
    name: string;
    image_key: string | null;
    first_consumed_at: number | null;
    available_at: number;
    created_at: number;
}

interface SessionRow {
    id: string;
    user_id: string;
    category_id: string;
    subject_entry_id: string;
    source: RankingSource;
    from_category_id: string | null;
    lower_bound: number;
    upper_bound: number;
    pivot_entry_id: string | null;
    pivot_rank_position: number | null;
    final_rank_position: number | null;
    original_rank_position?: number | null;
    created_at: number;
    comparison_count?: number;
    phase?: string;
    operation_kind?: RankingOperationKind | string;
    secondary_entry_id?: string | null;
    secondary_original_rank_position?: number | null;
    operation_state?: string | null;
}

interface ActiveBinarySessionRow {
    id: string;
    category_id: string;
    category_name: string;
    subject_name: string;
    source: RankingSource;
    operation_kind?: RankingOperationKind | string;
}

interface ActiveSessionRepairRow {
    id: string;
    category_id: string;
    subject_entry_id: string;
    source: RankingSource;
    lower_bound: number;
    upper_bound: number;
    pivot_entry_id: string | null;
    pivot_rank_position: number | null;
    created_at: number;
    category_exists: string | null;
    subject_id: string | null;
    subject_name: string | null;
    subject_category_id: string | null;
    subject_image_key: string | null;
    subject_status: string | null;
    pivot_id: string | null;
    pivot_category_id: string | null;
    pivot_status: string | null;
    original_rank_position?: number | null;
    phase?: string;
    operation_kind?: RankingOperationKind | string;
    secondary_entry_id?: string | null;
    secondary_original_rank_position?: number | null;
    operation_state?: string | null;
    secondary_id?: string | null;
    secondary_category_id?: string | null;
    secondary_status?: string | null;
}

interface OrphanedRankingEntryRow {
    id: string;
    category_id: string;
    name: string;
    image_key: string | null;
    session_source: RankingSource | null;
}

const IMPORT_BATCH_SIZE = 100;
const DEFAULT_QUEUE_DELAY_DAYS = 3;
const MAX_QUEUE_DELAY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RandomAuditOperationState {
    kind: "random_audit";
    higherEntryId: string;
    lowerEntryId: string;
    higherOriginalRankPosition: number;
    lowerOriginalRankPosition: number;
    bubble: RandomAuditBubbleState;
}

interface RankingOperationStateEnvelope {
    kind: "ranking_operation_state";
    comparisons: RankingComparison[];
    bubbleRepair: BubbleRepairState | null;
    randomAudit: RandomAuditOperationState | null;
}

export async function loadDashboard(userId: string): Promise<DashboardData> {
    const db = getDb();
    await repairInterruptedRankingState(userId);
    const queueSettings = await getQueueSettings(userId);
    const queuedEntries = await listQueuedEntries(userId);
    const activeBinarySession = await getActiveBinarySession(userId);
    const categories = await all<CategoryRow>(
        db
            .prepare(
                `SELECT id, name, sort_order, created_at, star_rating_curve
         FROM categories
         WHERE user_id = ?
         ORDER BY sort_order ASC, name ASC`
            )
            .bind(userId)
    );

    if (categories.length === 0) {
        return { categories: [], queueSettings, queuedEntries, activeBinarySession };
    }

    const entryRows = await all<EntryRow>(
        db
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND status = 'active'
         ORDER BY category_id ASC, rank_position ASC`
            )
            .bind(userId)
    );
    const entriesByCategory = new Map<string, Entry[]>();
    for (const row of entryRows) {
        const entries = entriesByCategory.get(row.category_id) ?? [];
        entries.push(mapEntry(row));
        entriesByCategory.set(row.category_id, entries);
    }

    return {
        categories: categories.map((category) => ({
            id: category.id,
            name: category.name,
            sortOrder: category.sort_order,
            createdAt: category.created_at,
            starRatingCurve: parseStoredCategoryStarRatingCurve(category.star_rating_curve),
            entries: orderEntries(entriesByCategory.get(category.id) ?? [])
        })),
        queueSettings,
        queuedEntries,
        activeBinarySession
    };
}

export async function createCategory(userId: string, name: string) {
    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("Category name is required");
    }

    const db = getDb();
    const maxSort = await first<{ max_sort: number | null }>(
        db
            .prepare(
                `SELECT MAX(sort_order) AS max_sort
         FROM categories
         WHERE user_id = ?`
            )
            .bind(userId)
    );
    const createdAt = now();
    const id = newId("cat");

    await db
        .prepare(
            `INSERT INTO categories (id, user_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(id, userId, cleanName, (maxSort?.max_sort ?? -1) + 1, createdAt, createdAt)
        .run();

    return id;
}

export async function renameCategory(userId: string, categoryId: string, name: string) {
    const category = await getOwnedCategory(userId, categoryId);
    assertOwned(category, "Category");

    const cleanName = name.trim();
    if (!cleanName) {
        throw new Error("Category name is required");
    }

    const updatedAt = now();
    await getDb()
        .prepare(
            `UPDATE categories
       SET name = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
        )
        .bind(cleanName, updatedAt, userId, categoryId)
        .run();
}

export async function deleteCategory(userId: string, categoryId: string) {
    const category = await getOwnedCategory(userId, categoryId);
    assertOwned(category, "Category");
    await assertNoActiveBinarySession(userId);

    const db = getDb();
    const imageRows = await all<{ image_key: string | null }>(
        db
            .prepare(
                `SELECT image_key
         FROM entries
         WHERE user_id = ? AND category_id = ? AND image_key IS NOT NULL
         UNION ALL
         SELECT image_key
         FROM entry_queue
         WHERE user_id = ? AND category_id = ? AND image_key IS NOT NULL`
            )
            .bind(userId, categoryId, userId, categoryId)
    );
    const imageKeys = Array.from(new Set(
        imageRows
            .map((row) => row.image_key)
            .filter((imageKey): imageKey is string => hasStoredImage(imageKey))
    ));

    await db.batch([
        db
            .prepare(`DELETE FROM ranking_sessions WHERE user_id = ? AND category_id = ?`)
            .bind(userId, categoryId),
        db
            .prepare(`DELETE FROM entry_queue WHERE user_id = ? AND category_id = ?`)
            .bind(userId, categoryId),
        db
            .prepare(`DELETE FROM entries WHERE user_id = ? AND category_id = ?`)
            .bind(userId, categoryId),
        db
            .prepare(`DELETE FROM categories WHERE user_id = ? AND id = ?`)
            .bind(userId, categoryId),
        db
            .prepare(
                `UPDATE categories
         SET sort_order = sort_order - 1, updated_at = ?
         WHERE user_id = ? AND sort_order > ?`
            )
            .bind(now(), userId, category.sort_order)
    ]);

    await Promise.all(imageKeys.map((imageKey) => env.IMAGES.delete(imageKey)));
}

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
        showStarRatings: boolean;
        starRatingCurve: QueueSettings["starRatingCurve"];
    }
) {
    const delayDays = normalizeQueueDelayDays(input.delayDays);
    const starRatingCurve = normalizeStarRatingCurve(input.starRatingCurve);
    const updatedAt = now();

    await getDb()
        .prepare(
            `INSERT INTO queue_settings (
         user_id, enabled, delay_days, prompt_missing_images, show_star_ratings,
         star_rating_curve, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled,
         delay_days = excluded.delay_days,
         prompt_missing_images = excluded.prompt_missing_images,
         show_star_ratings = excluded.show_star_ratings,
         star_rating_curve = excluded.star_rating_curve,
         updated_at = excluded.updated_at`
        )
        .bind(
            userId,
            input.enabled ? 1 : 0,
            delayDays,
            input.promptForMissingImages ? 1 : 0,
            input.showStarRatings ? 1 : 0,
            JSON.stringify(starRatingCurve),
            updatedAt,
            updatedAt
        )
        .run();

    return getQueueSettings(userId);
}

export async function updateCategoryStarRatingCurve(
    userId: string,
    input: {
        categoryId: string;
        starRatingCurve: QueueSettings["starRatingCurve"] | null;
    }
) {
    const category = await getOwnedCategory(userId, input.categoryId);
    assertOwned(category, "Category");

    const updatedAt = now();
    const starRatingCurve = input.starRatingCurve
        ? JSON.stringify(normalizeStarRatingCurve(input.starRatingCurve))
        : null;

    await getDb()
        .prepare(
            `UPDATE categories
       SET star_rating_curve = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
        )
        .bind(starRatingCurve, updatedAt, userId, input.categoryId)
        .run();

    return parseStoredCategoryStarRatingCurve(starRatingCurve);
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

    if (hasStoredImage(queuedEntry.imageKey)) {
        await env.IMAGES.delete(queuedEntry.imageKey);
    }
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

export async function startRandomAuditRanking(
    userId: string,
    input: {
        categoryId: string;
        entryAId: string;
        entryBId: string;
        winnerId: string;
    }
) {
    const db = getDb();
    await assertNoActiveBinarySession(userId);

    const entryA = await getOwnedActiveEntry(userId, input.entryAId);
    const entryB = await getOwnedActiveEntry(userId, input.entryBId);
    assertOwned(entryA, "First audit entry");
    assertOwned(entryB, "Second audit entry");

    if (entryA.categoryId !== input.categoryId || entryB.categoryId !== input.categoryId) {
        throw new Error("Random audit entries must belong to the selected category");
    }

    if (entryA.categoryId !== entryB.categoryId) {
        throw new Error("Random audit cannot cross categories");
    }

    if (input.winnerId !== entryA.id && input.winnerId !== entryB.id) {
        throw new Error("Winner must be one of the audit entries");
    }

    const higherEntry = entryA.rankPosition < entryB.rankPosition ? entryA : entryB;
    const lowerEntry = higherEntry.id === entryA.id ? entryB : entryA;
    if (input.winnerId === higherEntry.id) {
        return { kind: "completed" as const, changed: false, sessionId: null };
    }

    const activeEntries = await listActiveEntries(userId, input.categoryId);
    if (activeEntries.length < 2) {
        return { kind: "completed" as const, changed: false, sessionId: null };
    }

    const updatedAt = now();
    const orderedIds = activeEntries.map((entry) => entry.id);
    const state: RandomAuditOperationState = {
        kind: "random_audit",
        higherEntryId: higherEntry.id,
        lowerEntryId: lowerEntry.id,
        higherOriginalRankPosition: higherEntry.rankPosition,
        lowerOriginalRankPosition: lowerEntry.rankPosition,
        bubble: startRandomAuditBubbleState(orderedIds, higherEntry.id, lowerEntry.id)
    };
    const operationState = addCachedComparison(
        randomAuditOperationState(state),
        lowerEntry.id,
        higherEntry.id
    );
    const result = advanceRandomAuditBubbleState(state.bubble, operationState.comparisons);
    const nextState = {
        ...state,
        bubble: result.state
    };
    operationState.randomAudit = nextState;

    if (result.complete) {
        return commitRandomAuditBubbleOrder(
            db,
            userId,
            input.categoryId,
            nextState,
            updatedAt,
            null,
            false
        );
    }

    return startRandomAuditBubbleSession(db, userId, input.categoryId, nextState, operationState, updatedAt);
}

export async function moveEntryOnePosition(
    userId: string,
    input: { entryId: string; direction: "up" | "down" }
) {
    await assertNoActiveBinarySession(userId);
    const entry = await getOwnedActiveEntry(userId, input.entryId);
    assertOwned(entry, "Entry");

    const targetRankPosition = input.direction === "up"
        ? entry.rankPosition - 1
        : entry.rankPosition + 1;
    if (targetRankPosition < 0) {
        return { moved: false };
    }

    const db = getDb();
    const neighbor = await first<EntryRow>(
        db
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position = ?`
            )
            .bind(userId, entry.categoryId, targetRankPosition)
    );
    if (!neighbor) {
        return { moved: false };
    }

    const updatedAt = now();
    await db.batch([
        db
            .prepare(
                `UPDATE entries
         SET rank_position = ?, updated_at = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`
            )
            .bind(targetRankPosition, updatedAt, userId, entry.id),
        db
            .prepare(
                `UPDATE entries
         SET rank_position = ?, updated_at = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`
            )
            .bind(entry.rankPosition, updatedAt, userId, neighbor.id)
    ]);

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

export async function getBinarySession(
    userId: string,
    sessionId: string
): Promise<BinarySessionView | null> {
    const db = getDb();
    await repairInterruptedRankingState(userId);
    const session = await first<SessionRow>(
        db
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, lower_bound,
                upper_bound, pivot_entry_id, pivot_rank_position, from_category_id,
                final_rank_position, created_at, comparison_count, phase,
                operation_kind, secondary_entry_id, secondary_original_rank_position,
                operation_state
         FROM ranking_sessions
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(sessionId, userId)
    );

    if (!session?.pivot_entry_id) {
        return null;
    }

    const operationState = parseRankingOperationState(session.operation_state);
    const auditComparison = normalizeOperationKind(session.operation_kind) === "random_audit"
        ? operationState.randomAudit?.bubble.currentComparison ?? null
        : null;
    const repairComparison = session.phase === "bubble_repair"
        ? operationState.bubbleRepair?.currentComparison ?? null
        : null;
    const activeComparison = auditComparison ?? repairComparison;
    const category = await getOwnedCategory(userId, session.category_id);
    const subject = await getOwnedEntry(
        userId,
        activeComparison?.entryAId ?? session.subject_entry_id
    );
    const opponent = await getOwnedEntry(
        userId,
        activeComparison?.entryBId ?? session.pivot_entry_id
    );

    if (!category || !subject || !opponent) {
        return null;
    }

    return {
        id: session.id,
        categoryId: session.category_id,
        categoryName: category.name,
        source: session.source,
        operationKind: normalizeOperationKind(session.operation_kind),
        phase: session.phase && session.phase !== "binary" ? "local_repair" : "binary",
        subject,
        opponent,
        lowerBound: session.lower_bound,
        upperBound: session.upper_bound,
        comparisonCount: session.comparison_count ?? 0
    };
}

export async function cancelBinarySession(userId: string, sessionId: string) {
    const db = getDb();
    const session = await first<SessionRow>(
        db
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, lower_bound,
                upper_bound, pivot_entry_id, pivot_rank_position, from_category_id,
                final_rank_position, original_rank_position, created_at, phase,
                operation_kind, secondary_entry_id, secondary_original_rank_position,
                operation_state
         FROM ranking_sessions
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(sessionId, userId)
    );
    assertOwned(session, "Ranking session");

    if (session.source !== "new_entry" && session.source !== "rerank_entry") {
        throw new Error("Only new-entry and rerank sessions can be cancelled");
    }

    const entry = await getOwnedEntry(userId, session.subject_entry_id);
    assertOwned(entry, "Entry");

    const updatedAt = now();
    if (normalizeOperationKind(session.operation_kind) === "random_audit") {
        await cancelRandomAuditSession(db, userId, session, updatedAt);
        return;
    }

    const statements: D1PreparedStatement[] = [
        db
            .prepare(
                `UPDATE ranking_sessions
         SET status = 'cancelled', completed_at = ?,
             pivot_entry_id = NULL, pivot_rank_position = NULL
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(updatedAt, session.id, userId),
    ];

    if (session.source === "rerank_entry") {
        const restoreRankPosition = session.original_rank_position ?? session.final_rank_position ?? await getNextActiveRankPosition(
            userId,
            session.category_id
        );
        statements.push(
            db
                .prepare(
                    `UPDATE entries
         SET rank_position = rank_position + 1, updated_at = ?
         WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position >= ?`
                )
                .bind(updatedAt, userId, session.category_id, restoreRankPosition),
            db
                .prepare(
                    `UPDATE entries
         SET status = 'active', rank_position = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'ranking'`
                )
                .bind(restoreRankPosition, updatedAt, session.subject_entry_id, userId)
        );

        await db.batch(statements);
        return;
    }

    const startedQueuedEntry = await getStartedQueuedEntryForRanking(
        db,
        userId,
        session.category_id,
        entry.name
    );
    statements.push(
        db
            .prepare(
                `UPDATE entries
         SET status = 'deleted', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'ranking'`
            )
            .bind(updatedAt, session.subject_entry_id, userId)
    );

    if (startedQueuedEntry) {
        statements.push(
            restoreStartedQueuedEntryStatement(
                db,
                userId,
                startedQueuedEntry.id,
                session.category_id,
                entry.name,
                updatedAt
            )
        );
    }

    await db.batch(statements);
    if (!startedQueuedEntry && hasStoredImage(entry.imageKey)) {
        await env.IMAGES.delete(entry.imageKey);
    }
}

export async function submitBinaryWinner(
    userId: string,
    input: { sessionId: string; winnerId: string }
) {
    const db = getDb();
    const session = await first<SessionRow>(
        db
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, lower_bound,
                upper_bound, pivot_entry_id, pivot_rank_position, from_category_id,
                final_rank_position, original_rank_position, created_at, phase,
                operation_kind, secondary_entry_id, secondary_original_rank_position,
                operation_state
         FROM ranking_sessions
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(input.sessionId, userId)
    );
    assertOwned(session, "Ranking session");

    if (!session.pivot_entry_id || session.pivot_rank_position === null) {
        throw new Error("Ranking session has no active matchup");
    }

    const createdAt = now();
    const operationState = parseRankingOperationState(session.operation_state);
    if (
        normalizeOperationKind(session.operation_kind) === "random_audit" &&
        operationState.randomAudit?.bubble.currentComparison
    ) {
        return submitRandomAuditBubbleWinner(db, userId, session, input.winnerId, createdAt);
    }

    if (session.phase === "bubble_repair") {
        return submitBubbleRepairWinner(db, userId, session, input.winnerId, createdAt);
    }

    if (
        input.winnerId !== session.subject_entry_id &&
        input.winnerId !== session.pivot_entry_id
    ) {
        throw new Error("Winner must be one of the active matchup entries");
    }

    if (session.phase === "repair_up" || session.phase === "repair_down") {
        return submitLocalRepairWinner(db, userId, session, input.winnerId, createdAt);
    }

    const subjectWon = input.winnerId === session.subject_entry_id;
    const loserId = subjectWon ? session.pivot_entry_id : session.subject_entry_id;
    const nextOperationState = addCachedComparison(operationState, input.winnerId, loserId);
    const lowerBound = subjectWon
        ? session.lower_bound
        : session.pivot_rank_position + 1;
    const upperBound = subjectWon
        ? session.pivot_rank_position
        : session.upper_bound;

    if (lowerBound < upperBound) {
        const opponents = await listActiveEntries(userId, session.category_id);
        const pivotIndex = chooseBinaryPivot(lowerBound, upperBound);
        const pivot = opponents[pivotIndex];
        assertOwned(pivot, "Pivot entry");

        await db.batch([
            db
                .prepare(
                    `UPDATE ranking_sessions
         SET lower_bound = ?, upper_bound = ?, pivot_entry_id = ?,
             pivot_rank_position = ?, operation_state = ?,
             comparison_count = comparison_count + 1
         WHERE id = ? AND user_id = ?`
                )
                .bind(
                    lowerBound,
                    upperBound,
                    pivot.id,
                    pivot.rankPosition,
                    serializeRankingOperationState(nextOperationState),
                    session.id,
                    userId
                )
        ]);

        return { kind: "session" as const, sessionId: session.id };
    }

    if (normalizeOperationKind(session.operation_kind) === "random_audit") {
        const randomAudit = operationState.randomAudit;
        if (randomAudit) {
            nextOperationState.randomAudit = randomAudit;
        }

        await db
            .prepare(
                `UPDATE ranking_sessions
       SET operation_state = ?
       WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(serializeRankingOperationState(nextOperationState), session.id, userId)
            .run();
        return completeRankingSession(db, userId, session, lowerBound, createdAt, true);
    }

    return startBubbleRepairOrCommit(
        db,
        userId,
        session,
        lowerBound,
        createdAt,
        nextOperationState,
        true
    );
}

async function submitLocalRepairWinner(
    db: D1Database,
    userId: string,
    session: SessionRow,
    winnerId: string,
    updatedAt: number
) {
    const subjectWon = winnerId === session.subject_entry_id;
    const currentFinalRank = session.final_rank_position ?? session.lower_bound;
    const pivotRank = session.pivot_rank_position ?? currentFinalRank;

    if (session.phase === "repair_up") {
        if (subjectWon) {
            return continueUpwardRepairOrCommit(db, userId, session, pivotRank, updatedAt, true);
        }

        const wasInitialLeftCheck = pivotRank === currentFinalRank - 1;
        if (wasInitialLeftCheck) {
            return startLocalRepairOrCommit(db, userId, session, currentFinalRank, updatedAt, {
                countCurrentComparison: true,
                allowUpwardCheck: false
            });
        }

        return completeRankingSession(db, userId, session, currentFinalRank, updatedAt, true);
    }

    if (!subjectWon) {
        return continueDownwardRepairOrCommit(db, userId, session, pivotRank + 1, updatedAt, true);
    }

    return completeRankingSession(db, userId, session, currentFinalRank, updatedAt, true);
}

async function submitBubbleRepairWinner(
    db: D1Database,
    userId: string,
    session: SessionRow,
    winnerId: string,
    updatedAt: number
) {
    const operationState = parseRankingOperationState(session.operation_state);
    const bubbleRepair = operationState.bubbleRepair;
    const currentComparison = bubbleRepair?.currentComparison;
    if (!bubbleRepair || !currentComparison) {
        throw new Error("Ranking session has no active repair matchup");
    }

    if (
        winnerId !== currentComparison.entryAId &&
        winnerId !== currentComparison.entryBId
    ) {
        throw new Error("Winner must be one of the active matchup entries");
    }

    const loserId = winnerId === currentComparison.entryAId
        ? currentComparison.entryBId
        : currentComparison.entryAId;
    const nextOperationState = addCachedComparison(operationState, winnerId, loserId);
    const result = advanceBubbleRepairState(bubbleRepair, nextOperationState.comparisons);
    nextOperationState.bubbleRepair = result.state;

    if (result.complete) {
        return completeBubbleRepairSession(
            db,
            userId,
            session,
            result.state.workingOrderIds,
            updatedAt,
            nextOperationState,
            true
        );
    }

    await updateBubbleRepairPrompt(db, userId, session, nextOperationState, true);
    return { kind: "session" as const, sessionId: session.id };
}

async function startBubbleRepairOrCommit(
    db: D1Database,
    userId: string,
    session: SessionRow,
    finalRankPosition: number,
    updatedAt: number,
    operationState: RankingOperationStateEnvelope,
    countCurrentComparison: boolean
) {
    const entries = await listActiveEntries(userId, session.category_id);
    const workingOrderIds = entries.map((entry) => entry.id);
    workingOrderIds.splice(
        clampInsertionIndex(finalRankPosition, workingOrderIds.length),
        0,
        session.subject_entry_id
    );

    const bubbleRepair = startBubbleRepairState(workingOrderIds, session.subject_entry_id);
    const result = advanceBubbleRepairState(bubbleRepair, operationState.comparisons);
    operationState.bubbleRepair = result.state;

    if (result.complete) {
        return completeBubbleRepairSession(
            db,
            userId,
            session,
            result.state.workingOrderIds,
            updatedAt,
            operationState,
            countCurrentComparison
        );
    }

    await updateBubbleRepairPrompt(db, userId, session, operationState, countCurrentComparison);
    return { kind: "session" as const, sessionId: session.id };
}

async function updateBubbleRepairPrompt(
    db: D1Database,
    userId: string,
    session: SessionRow,
    operationState: RankingOperationStateEnvelope,
    countCurrentComparison: boolean
) {
    const comparison = operationState.bubbleRepair?.currentComparison;
    const bubbleRepair = operationState.bubbleRepair;
    if (!comparison || !bubbleRepair) {
        throw new Error("Bubble repair has no active matchup");
    }

    const opponent = await getOwnedEntry(userId, comparison.entryBId);
    assertOwned(opponent, "Repair opponent");

    await db
        .prepare(
            `UPDATE ranking_sessions
       SET phase = 'bubble_repair',
           final_rank_position = ?,
           pivot_entry_id = ?,
           pivot_rank_position = ?,
           operation_state = ?,
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ? AND status = 'active'`
        )
        .bind(
            bubbleRepair.workingOrderIds.indexOf(session.subject_entry_id),
            comparison.entryBId,
            opponent.rankPosition,
            serializeRankingOperationState(operationState),
            countCurrentComparison ? 1 : 0,
            session.id,
            userId
        )
        .run();
}

async function completeBubbleRepairSession(
    db: D1Database,
    userId: string,
    session: SessionRow,
    workingOrderIds: string[],
    updatedAt: number,
    operationState: RankingOperationStateEnvelope,
    countCurrentComparison: boolean
) {
    const finalRankPosition = workingOrderIds.indexOf(session.subject_entry_id);
    if (finalRankPosition < 0) {
        throw new Error("Ranked entry is missing from the repaired order");
    }

    operationState.bubbleRepair = null;
    await db.batch([
        ...rewriteCategoryOrderStatements(db, userId, session.category_id, workingOrderIds, updatedAt),
        db
            .prepare(
                `UPDATE ranking_sessions
       SET status = 'completed', final_rank_position = ?, completed_at = ?,
           pivot_entry_id = NULL, pivot_rank_position = NULL,
           phase = 'binary',
           operation_state = ?,
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ?`
            )
            .bind(
                finalRankPosition,
                updatedAt,
                serializeRankingOperationState(operationState),
                countCurrentComparison ? 1 : 0,
                session.id,
                userId
            )
    ]);

    return { kind: "completed" as const, sessionId: session.id, finalRankPosition };
}

async function submitRandomAuditBubbleWinner(
    db: D1Database,
    userId: string,
    session: SessionRow,
    winnerId: string,
    updatedAt: number
) {
    const operationState = parseRankingOperationState(session.operation_state);
    const randomAudit = operationState.randomAudit;
    const currentComparison = randomAudit?.bubble.currentComparison;
    if (!randomAudit || !currentComparison) {
        throw new Error("Random audit session has no active repair matchup");
    }

    if (
        winnerId !== currentComparison.entryAId &&
        winnerId !== currentComparison.entryBId
    ) {
        throw new Error("Winner must be one of the active matchup entries");
    }

    const loserId = winnerId === currentComparison.entryAId
        ? currentComparison.entryBId
        : currentComparison.entryAId;
    const nextOperationState = addCachedComparison(operationState, winnerId, loserId);
    const result = advanceRandomAuditBubbleState(
        randomAudit.bubble,
        nextOperationState.comparisons
    );
    const nextRandomAudit = {
        ...randomAudit,
        bubble: result.state
    };
    nextOperationState.randomAudit = nextRandomAudit;

    if (result.complete) {
        return commitRandomAuditBubbleOrder(
            db,
            userId,
            session.category_id,
            nextRandomAudit,
            updatedAt,
            session,
            true
        );
    }

    await updateRandomAuditBubblePrompt(db, userId, session, nextOperationState, true);
    return { kind: "session" as const, sessionId: session.id };
}

async function startRandomAuditBubbleSession(
    db: D1Database,
    userId: string,
    categoryId: string,
    state: RandomAuditOperationState,
    operationState: RankingOperationStateEnvelope,
    createdAt: number
) {
    const comparison = state.bubble.currentComparison;
    if (!comparison) {
        throw new Error("Random audit repair has no active matchup");
    }

    const opponent = await getOwnedEntry(userId, comparison.entryBId);
    assertOwned(opponent, "Audit repair opponent");
    const secondary = randomAuditSecondaryEntry(state, comparison.entryAId);
    const sessionId = newId("rank");

    await db
        .prepare(
            `INSERT INTO ranking_sessions (
           id, user_id, category_id, subject_entry_id, source, from_category_id, lower_bound,
           upper_bound, pivot_entry_id, pivot_rank_position, final_rank_position,
           original_rank_position, status, created_at, operation_kind, secondary_entry_id,
           secondary_original_rank_position, operation_state, phase
         )
         VALUES (?, ?, ?, ?, 'rerank_entry', NULL, 0, ?, ?, ?, ?, ?, 'active', ?, 'random_audit', ?, ?, ?, 'bubble_repair')`
        )
        .bind(
            sessionId,
            userId,
            categoryId,
            comparison.entryAId,
            state.bubble.workingOrderIds.length,
            comparison.entryBId,
            opponent.rankPosition,
            state.bubble.workingOrderIds.indexOf(comparison.entryAId),
            randomAuditOriginalRankPosition(state, comparison.entryAId),
            createdAt,
            secondary.id,
            secondary.originalRankPosition,
            serializeRankingOperationState(operationState)
        )
        .run();

    return { kind: "session" as const, entryId: comparison.entryAId, sessionId };
}

async function updateRandomAuditBubblePrompt(
    db: D1Database,
    userId: string,
    session: SessionRow,
    operationState: RankingOperationStateEnvelope,
    countCurrentComparison: boolean
) {
    const randomAudit = operationState.randomAudit;
    const comparison = randomAudit?.bubble.currentComparison;
    if (!randomAudit || !comparison) {
        throw new Error("Random audit repair has no active matchup");
    }

    const opponent = await getOwnedEntry(userId, comparison.entryBId);
    assertOwned(opponent, "Audit repair opponent");
    const secondary = randomAuditSecondaryEntry(randomAudit, comparison.entryAId);

    await db
        .prepare(
            `UPDATE ranking_sessions
       SET subject_entry_id = ?,
           original_rank_position = ?,
           secondary_entry_id = ?,
           secondary_original_rank_position = ?,
           pivot_entry_id = ?,
           pivot_rank_position = ?,
           final_rank_position = ?,
           phase = 'bubble_repair',
           operation_state = ?,
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ? AND status = 'active'`
        )
        .bind(
            comparison.entryAId,
            randomAuditOriginalRankPosition(randomAudit, comparison.entryAId),
            secondary.id,
            secondary.originalRankPosition,
            comparison.entryBId,
            opponent.rankPosition,
            randomAudit.bubble.workingOrderIds.indexOf(comparison.entryAId),
            serializeRankingOperationState(operationState),
            countCurrentComparison ? 1 : 0,
            session.id,
            userId
        )
        .run();
}

async function commitRandomAuditBubbleOrder(
    db: D1Database,
    userId: string,
    categoryId: string,
    state: RandomAuditOperationState,
    updatedAt: number,
    session: SessionRow | null,
    countCurrentComparison: boolean
) {
    const activeEntryIds = (await listActiveEntries(userId, categoryId)).map((entry) => entry.id);
    const workingEntryIds = state.bubble.workingOrderIds;
    const workingEntryIdSet = new Set(workingEntryIds);
    if (
        workingEntryIds.length !== activeEntryIds.length ||
        workingEntryIdSet.size !== workingEntryIds.length ||
        !activeEntryIds.every((entryId) => workingEntryIdSet.has(entryId))
    ) {
        throw new Error("Random audit working order no longer matches the category");
    }

    const finalRankPosition = workingEntryIds.indexOf(state.lowerEntryId);
    const completedState: RandomAuditOperationState = {
        ...state,
        bubble: {
            ...state.bubble,
            currentComparison: null
        }
    };
    const statements = [
        ...rewriteCategoryOrderStatements(db, userId, categoryId, workingEntryIds, updatedAt)
    ];

    if (session) {
        statements.push(
            db
                .prepare(
                    `UPDATE ranking_sessions
       SET status = 'completed',
           final_rank_position = ?,
           completed_at = ?,
           pivot_entry_id = NULL,
           pivot_rank_position = NULL,
           phase = 'binary',
           operation_state = ?,
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ?`
                )
                .bind(
                    finalRankPosition,
                    updatedAt,
                    serializeRankingOperationState(randomAuditOperationState(completedState)),
                    countCurrentComparison ? 1 : 0,
                    session.id,
                    userId
                )
        );
    }

    await db.batch(statements);
    return {
        kind: "completed" as const,
        changed: true,
        sessionId: session?.id ?? null,
        finalRankPosition
    };
}

function randomAuditOriginalRankPosition(
    state: RandomAuditOperationState,
    entryId: string
) {
    if (entryId === state.higherEntryId) {
        return state.higherOriginalRankPosition;
    }

    if (entryId === state.lowerEntryId) {
        return state.lowerOriginalRankPosition;
    }

    throw new Error("Random audit subject is not one of the audited entries");
}

function randomAuditSecondaryEntry(
    state: RandomAuditOperationState,
    subjectEntryId: string
) {
    if (subjectEntryId === state.higherEntryId) {
        return {
            id: state.lowerEntryId,
            originalRankPosition: state.lowerOriginalRankPosition
        };
    }

    if (subjectEntryId === state.lowerEntryId) {
        return {
            id: state.higherEntryId,
            originalRankPosition: state.higherOriginalRankPosition
        };
    }

    throw new Error("Random audit subject is not one of the audited entries");
}

async function startLocalRepairOrCommit(
    db: D1Database,
    userId: string,
    session: SessionRow,
    finalRankPosition: number,
    updatedAt: number,
    options: {
        countCurrentComparison: boolean;
        allowUpwardCheck: boolean;
    }
) {
    const entries = await listActiveEntries(userId, session.category_id);

    if (options.allowUpwardCheck) {
        const upwardPivot = entries[finalRankPosition - 1];
        if (upwardPivot) {
            await updateRankingSessionPivot(
                db,
                userId,
                session.id,
                "repair_up",
                finalRankPosition,
                upwardPivot,
                options.countCurrentComparison
            );
            return { kind: "session" as const, sessionId: session.id };
        }
    }

    const downwardPivot = entries[finalRankPosition];
    if (downwardPivot) {
        await updateRankingSessionPivot(
            db,
            userId,
            session.id,
            "repair_down",
            finalRankPosition,
            downwardPivot,
            options.countCurrentComparison
        );
        return { kind: "session" as const, sessionId: session.id };
    }

    return completeRankingSession(
        db,
        userId,
        session,
        finalRankPosition,
        updatedAt,
        options.countCurrentComparison
    );
}

async function continueUpwardRepairOrCommit(
    db: D1Database,
    userId: string,
    session: SessionRow,
    finalRankPosition: number,
    updatedAt: number,
    countCurrentComparison: boolean
) {
    const entries = await listActiveEntries(userId, session.category_id);
    const nextPivot = entries[finalRankPosition - 1];
    if (nextPivot) {
        await updateRankingSessionPivot(
            db,
            userId,
            session.id,
            "repair_up",
            finalRankPosition,
            nextPivot,
            countCurrentComparison
        );
        return { kind: "session" as const, sessionId: session.id };
    }

    return completeRankingSession(db, userId, session, finalRankPosition, updatedAt, countCurrentComparison);
}

async function continueDownwardRepairOrCommit(
    db: D1Database,
    userId: string,
    session: SessionRow,
    finalRankPosition: number,
    updatedAt: number,
    countCurrentComparison: boolean
) {
    const entries = await listActiveEntries(userId, session.category_id);
    const nextPivot = entries[finalRankPosition];
    if (nextPivot) {
        await updateRankingSessionPivot(
            db,
            userId,
            session.id,
            "repair_down",
            finalRankPosition,
            nextPivot,
            countCurrentComparison
        );
        return { kind: "session" as const, sessionId: session.id };
    }

    return completeRankingSession(db, userId, session, finalRankPosition, updatedAt, countCurrentComparison);
}

async function updateRankingSessionPivot(
    db: D1Database,
    userId: string,
    sessionId: string,
    phase: "repair_up" | "repair_down",
    finalRankPosition: number,
    pivot: Entry,
    countCurrentComparison: boolean
) {
    await db
        .prepare(
            `UPDATE ranking_sessions
       SET phase = ?,
           final_rank_position = ?,
           pivot_entry_id = ?,
           pivot_rank_position = ?,
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ? AND status = 'active'`
        )
        .bind(
            phase,
            finalRankPosition,
            pivot.id,
            pivot.rankPosition,
            countCurrentComparison ? 1 : 0,
            sessionId,
            userId
        )
        .run();
}

async function completeRankingSession(
    db: D1Database,
    userId: string,
    session: SessionRow,
    finalRankPosition: number,
    updatedAt: number,
    countCurrentComparison: boolean
) {
    await db.batch([
        ...placeRankedEntryStatements(
            db,
            userId,
            session.subject_entry_id,
            session.category_id,
            finalRankPosition,
            updatedAt
        ),
        db
            .prepare(
                `UPDATE ranking_sessions
       SET status = 'completed', final_rank_position = ?, completed_at = ?,
           pivot_entry_id = NULL, pivot_rank_position = NULL,
           phase = 'binary',
           comparison_count = comparison_count + ?
       WHERE id = ? AND user_id = ?`
            )
            .bind(finalRankPosition, updatedAt, countCurrentComparison ? 1 : 0, session.id, userId)
    ]);

    return { kind: "completed" as const, sessionId: session.id, finalRankPosition };
}

export async function importLegacyEntries(userId: string, parsedImport: ParsedImport) {
    const db = getDb();
    await assertNoActiveBinarySession(userId);
    const createdAt = now();
    const categoriesByName = new Map<string, string>();
    const importedByCategory = new Map<string, typeof parsedImport.entries>();
    const existingCategories = await all<CategoryRow>(
        db
            .prepare(
                `SELECT id, name, sort_order, created_at
         FROM categories
         WHERE user_id = ?`
            )
            .bind(userId)
    );

    for (const category of existingCategories) {
        categoriesByName.set(category.name, category.id);
    }

    for (const entry of parsedImport.entries) {
        const categoryName = entry.categoryName.trim();
        const name = entry.name.trim();
        if (!categoryName || !name) {
            continue;
        }

        const bucket = importedByCategory.get(categoryName) ?? [];
        bucket.push({ ...entry, categoryName, name });
        importedByCategory.set(categoryName, bucket);
    }

    let sortOrder = Math.max(-1, ...existingCategories.map((category) => category.sort_order)) + 1;
    const categoryInsertStatements: D1PreparedStatement[] = [];

    for (const categoryName of importedByCategory.keys()) {
        if (!categoriesByName.has(categoryName)) {
            const categoryId = newId("cat");
            categoriesByName.set(categoryName, categoryId);
            categoryInsertStatements.push(
                db.prepare(
                    `INSERT INTO categories (id, user_id, name, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
                )
                    .bind(categoryId, userId, categoryName, sortOrder, createdAt, createdAt)
            );
            sortOrder += 1;
        }
    }

    await runBatches(db, categoryInsertStatements);

    const existingEntries = await all<ExistingEntryRow>(
        db
            .prepare(
                `SELECT category_id, name, status
         FROM entries
         WHERE user_id = ? AND status != 'deleted'`
            )
            .bind(userId)
    );
    const namesByCategory = new Map<string, Set<string>>();
    const activeCountsByCategory = new Map<string, number>();
    for (const entry of existingEntries) {
        const names = namesByCategory.get(entry.category_id) ?? new Set<string>();
        names.add(entry.name);
        namesByCategory.set(entry.category_id, names);

        if (entry.status === "active") {
            activeCountsByCategory.set(
                entry.category_id,
                (activeCountsByCategory.get(entry.category_id) ?? 0) + 1
            );
        }
    }

    const existingQueuedEntries = await all<{ category_id: string; name: string }>(
        db
            .prepare(
                `SELECT category_id, name
         FROM entry_queue
         WHERE user_id = ? AND status = 'queued'`
            )
            .bind(userId)
    );
    for (const entry of existingQueuedEntries) {
        const names = namesByCategory.get(entry.category_id) ?? new Set<string>();
        names.add(entry.name);
        namesByCategory.set(entry.category_id, names);
    }

    const entryInsertStatements: D1PreparedStatement[] = [];
    let importedCount = 0;
    let skippedCount = 0;

    for (const [categoryName, entries] of importedByCategory) {
        const categoryId = categoriesByName.get(categoryName);
        if (!categoryId) {
            continue;
        }

        entries.sort((left, right) => left.rankPosition - right.rankPosition);
        const knownNames = namesByCategory.get(categoryId) ?? new Set<string>();
        namesByCategory.set(categoryId, knownNames);
        let rankPosition = activeCountsByCategory.get(categoryId) ?? 0;
        const insertableEntries = entries.filter((entry) => {
            if (knownNames.has(entry.name)) {
                skippedCount += 1;
                return false;
            }

            knownNames.add(entry.name);
            return true;
        });
        for (const entry of insertableEntries) {
            const entryId = newId("entry");
            entryInsertStatements.push(
                db.prepare(
                    `INSERT OR IGNORE INTO entries (
             id, user_id, category_id, name, rank_position, status, image_key,
             created_at, first_consumed_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
                )
                    .bind(
                        entryId,
                        userId,
                        categoryId,
                        entry.name,
                        rankPosition,
                        null,
                        createdAt,
                        entry.firstConsumedAt,
                        createdAt
                    )
            );
            importedCount += 1;
            rankPosition += 1;
        }

        activeCountsByCategory.set(categoryId, rankPosition);
    }

    await runBatches(db, entryInsertStatements);

    return { importedCount, skippedCount };
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
    for (let index = 0; index < statements.length; index += IMPORT_BATCH_SIZE) {
        await db.batch(statements.slice(index, index + IMPORT_BATCH_SIZE));
    }
}

async function getQueueSettings(userId: string): Promise<QueueSettings> {
    const row = await first<QueueSettingsRow>(
        getDb()
            .prepare(
                `SELECT enabled, delay_days, prompt_missing_images, show_star_ratings,
                star_rating_curve
         FROM queue_settings
         WHERE user_id = ?`
            )
            .bind(userId)
    );

    return {
        enabled: row?.enabled === 1,
        delayDays: normalizeQueueDelayDays(row?.delay_days ?? DEFAULT_QUEUE_DELAY_DAYS),
        promptForMissingImages: row?.prompt_missing_images !== 0,
        showStarRatings: row?.show_star_ratings !== 0,
        starRatingCurve: parseStoredStarRatingCurve(row?.star_rating_curve)
    };
}

function parseStoredStarRatingCurve(value: string | null | undefined) {
    if (!value) {
        return normalizeStarRatingCurve(null);
    }

    try {
        return normalizeStarRatingCurve(JSON.parse(value));
    } catch {
        return normalizeStarRatingCurve(null);
    }
}

function parseStoredCategoryStarRatingCurve(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    try {
        return normalizeStarRatingCurve(JSON.parse(value));
    } catch {
        return null;
    }
}

async function listQueuedEntries(userId: string): Promise<QueuedEntry[]> {
    const rows = await all<QueuedEntryRow>(
        getDb()
            .prepare(
                `SELECT entry_queue.id, entry_queue.category_id, categories.name AS category_name,
                entry_queue.name, entry_queue.image_key, entry_queue.first_consumed_at, entry_queue.available_at,
                entry_queue.created_at
         FROM entry_queue
         INNER JOIN categories ON categories.id = entry_queue.category_id
         WHERE entry_queue.user_id = ? AND entry_queue.status = 'queued'
         ORDER BY entry_queue.available_at ASC, entry_queue.created_at ASC`
            )
            .bind(userId)
    );

    return rows.map(mapQueuedEntry);
}

async function getOwnedQueuedEntry(userId: string, queuedEntryId: string) {
    const row = await first<QueuedEntryRow>(
        getDb()
            .prepare(
                `SELECT entry_queue.id, entry_queue.category_id, categories.name AS category_name,
                entry_queue.name, entry_queue.image_key, entry_queue.first_consumed_at, entry_queue.available_at,
                entry_queue.created_at
         FROM entry_queue
         INNER JOIN categories ON categories.id = entry_queue.category_id
         WHERE entry_queue.id = ? AND entry_queue.user_id = ? AND entry_queue.status = 'queued'`
            )
            .bind(queuedEntryId, userId)
    );

    return row ? mapQueuedEntry(row) : null;
}

async function assertEntryNameAvailable(
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

function normalizeQueueDelayDays(value: number) {
    if (!Number.isFinite(value)) {
        return DEFAULT_QUEUE_DELAY_DAYS;
    }

    return Math.max(0, Math.min(MAX_QUEUE_DELAY_DAYS, Math.floor(value)));
}

async function getActiveBinarySession(userId: string): Promise<ActiveBinarySession | null> {
    const row = await first<ActiveBinarySessionRow>(
        getDb()
            .prepare(
                `SELECT ranking_sessions.id, ranking_sessions.category_id,
                categories.name AS category_name, entries.name AS subject_name,
                ranking_sessions.source, ranking_sessions.operation_kind
         FROM ranking_sessions
         INNER JOIN categories ON categories.id = ranking_sessions.category_id
         INNER JOIN entries ON entries.id = ranking_sessions.subject_entry_id
         WHERE ranking_sessions.user_id = ? AND ranking_sessions.status = 'active'
         ORDER BY ranking_sessions.created_at DESC
         LIMIT 1`
            )
            .bind(userId)
    );

    return row
        ? {
            id: row.id,
            categoryId: row.category_id,
            categoryName: row.category_name,
            subjectName: row.subject_name,
            source: row.source,
            operationKind: normalizeOperationKind(row.operation_kind)
        }
        : null;
}

async function getActiveSessionRow(userId: string) {
    return first<SessionRow>(
        getDb()
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, from_category_id,
                lower_bound, upper_bound, pivot_entry_id, pivot_rank_position,
                final_rank_position, created_at, operation_kind, secondary_entry_id,
                secondary_original_rank_position, operation_state
         FROM ranking_sessions
         WHERE user_id = ? AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`
            )
            .bind(userId)
    );
}

async function assertNoActiveBinarySession(userId: string) {
    await repairInterruptedRankingState(userId);
    const activeSession = await getActiveSessionRow(userId);
    if (activeSession) {
        throw new Error("Finish or cancel the active ranking before starting another one");
    }
}

async function repairInterruptedRankingState(userId: string) {
    await cancelStaleActiveRankingSessions(userId);
    await recoverInterruptedRankingEntries(userId);
}

async function cancelStaleActiveRankingSessions(userId: string) {
    const db = getDb();
    const activeSessions = await all<ActiveSessionRepairRow>(
        db
            .prepare(
                `SELECT ranking_sessions.id, ranking_sessions.category_id,
                ranking_sessions.subject_entry_id, ranking_sessions.source,
                ranking_sessions.lower_bound, ranking_sessions.upper_bound,
                ranking_sessions.pivot_entry_id, ranking_sessions.pivot_rank_position,
                ranking_sessions.created_at, ranking_sessions.original_rank_position,
                ranking_sessions.phase, ranking_sessions.operation_kind,
                ranking_sessions.secondary_entry_id,
                ranking_sessions.secondary_original_rank_position,
                ranking_sessions.operation_state,
                categories.id AS category_exists,
                subject.id AS subject_id, subject.name AS subject_name,
                subject.category_id AS subject_category_id,
                subject.image_key AS subject_image_key,
                subject.status AS subject_status,
                pivot.id AS pivot_id, pivot.category_id AS pivot_category_id,
                pivot.status AS pivot_status,
                secondary.id AS secondary_id,
                secondary.category_id AS secondary_category_id,
                secondary.status AS secondary_status
         FROM ranking_sessions
         LEFT JOIN categories
           ON categories.id = ranking_sessions.category_id
          AND categories.user_id = ranking_sessions.user_id
         LEFT JOIN entries subject
           ON subject.id = ranking_sessions.subject_entry_id
          AND subject.user_id = ranking_sessions.user_id
         LEFT JOIN entries pivot
           ON pivot.id = ranking_sessions.pivot_entry_id
          AND pivot.user_id = ranking_sessions.user_id
         LEFT JOIN entries secondary
           ON secondary.id = ranking_sessions.secondary_entry_id
          AND secondary.user_id = ranking_sessions.user_id
         WHERE ranking_sessions.user_id = ? AND ranking_sessions.status = 'active'
         ORDER BY ranking_sessions.created_at DESC`
            )
            .bind(userId)
    );

    if (activeSessions.length === 0) {
        return;
    }

    const updatedAt = now();
    const nextRankByCategory = new Map<string, number>();
    const statements: D1PreparedStatement[] = [];
    const imageKeysToDelete: string[] = [];
    let keptActiveSessionId: string | null = null;

    for (const session of activeSessions) {
        const canResume = canResumeActiveSession(session);
        if (canResume && keptActiveSessionId === null) {
            keptActiveSessionId = session.id;
            continue;
        }

        if (normalizeOperationKind(session.operation_kind) === "random_audit") {
            const state = parseRandomAuditOperationState(session.operation_state);
            const stagedEntries = state
                ? [
                    session.subject_id
                        ? {
                            id: session.subject_entry_id,
                            originalRankPosition: session.subject_entry_id === state.higherEntryId
                                ? state.higherOriginalRankPosition
                                : state.lowerOriginalRankPosition
                        }
                        : null,
                    session.secondary_id && session.secondary_entry_id
                        ? {
                            id: session.secondary_entry_id,
                            originalRankPosition: session.secondary_entry_id === state.higherEntryId
                                ? state.higherOriginalRankPosition
                                : state.lowerOriginalRankPosition
                        }
                        : null
                ]
                : [
                    session.subject_id && session.original_rank_position !== null && session.original_rank_position !== undefined
                        ? {
                            id: session.subject_entry_id,
                            originalRankPosition: session.original_rank_position
                        }
                        : null,
                    session.secondary_id &&
                        session.secondary_entry_id &&
                        session.secondary_original_rank_position !== null &&
                        session.secondary_original_rank_position !== undefined
                        ? {
                            id: session.secondary_entry_id,
                            originalRankPosition: session.secondary_original_rank_position
                        }
                        : null
                ];
            const restoreEntries = stagedEntries
                .filter((entry): entry is { id: string; originalRankPosition: number } => Boolean(entry))
                .sort((left, right) => left.originalRankPosition - right.originalRankPosition);
            if (restoreEntries.length > 0) {
                const activeEntries = await listActiveEntries(userId, session.category_id);
                const restoreEntryIds = new Set(restoreEntries.map((entry) => entry.id));
                const orderedIds = activeEntries
                    .map((entry) => entry.id)
                    .filter((entryId) => !restoreEntryIds.has(entryId));
                for (const entry of restoreEntries) {
                    orderedIds.splice(
                        clampInsertionIndex(entry.originalRankPosition, orderedIds.length),
                        0,
                        entry.id
                    );
                }
                statements.push(...rewriteCategoryOrderStatements(
                    db,
                    userId,
                    session.category_id,
                    orderedIds,
                    updatedAt
                ));
            }
            statements.push(
                db
                    .prepare(
                        `UPDATE ranking_sessions
           SET status = 'cancelled', completed_at = ?,
               pivot_entry_id = NULL, pivot_rank_position = NULL,
               phase = 'binary'
           WHERE id = ? AND user_id = ? AND status = 'active'`
                    )
                    .bind(updatedAt, session.id, userId)
            );
            continue;
        }

        statements.push(
            db
                .prepare(
                    `UPDATE ranking_sessions
           SET status = 'cancelled', completed_at = ?,
               pivot_entry_id = NULL, pivot_rank_position = NULL
           WHERE id = ? AND user_id = ? AND status = 'active'`
                )
                .bind(updatedAt, session.id, userId)
        );

        if (
            session.subject_id &&
            session.subject_status === "ranking" &&
            session.subject_category_id
        ) {
            if (session.source === "new_entry") {
                statements.push(
                    db
                        .prepare(
                            `UPDATE entries
             SET status = 'deleted', updated_at = ?
             WHERE user_id = ? AND id = ? AND status = 'ranking'`
                        )
                        .bind(updatedAt, userId, session.subject_entry_id)
                );

                const startedQueuedEntry = session.subject_name
                    ? await getStartedQueuedEntryForRanking(
                        db,
                        userId,
                        session.subject_category_id,
                        session.subject_name
                    )
                    : null;
                if (startedQueuedEntry && session.subject_name) {
                    statements.push(
                        restoreStartedQueuedEntryStatement(
                            db,
                            userId,
                            startedQueuedEntry.id,
                            session.subject_category_id,
                            session.subject_name,
                            updatedAt
                        )
                    );
                } else if (hasStoredImage(session.subject_image_key)) {
                    imageKeysToDelete.push(session.subject_image_key);
                }

                continue;
            }

            let nextRank = nextRankByCategory.get(session.subject_category_id);
            if (nextRank === undefined) {
                nextRank = await getNextActiveRankPosition(userId, session.subject_category_id);
            }

            statements.push(
                db
                    .prepare(
                        `UPDATE entries
             SET status = 'active', rank_position = ?, updated_at = ?
             WHERE user_id = ? AND id = ? AND status = 'ranking'`
                    )
                    .bind(nextRank, updatedAt, userId, session.subject_entry_id)
            );
            nextRankByCategory.set(session.subject_category_id, nextRank + 1);
        }
    }

    await runBatches(db, statements);
    await Promise.all(Array.from(new Set(imageKeysToDelete)).map((imageKey) => env.IMAGES.delete(imageKey)));
}

function canResumeActiveSession(session: ActiveSessionRepairRow) {
    const operationKind = normalizeOperationKind(session.operation_kind);
    const hasValidBounds = session.phase && session.phase !== "binary"
        ? session.lower_bound >= 0
        : session.lower_bound >= 0 && session.upper_bound > session.lower_bound;
    const hasValidRandomAuditState = operationKind !== "random_audit" || Boolean(
        parseRankingOperationState(session.operation_state).randomAudit ||
        parseRandomAuditOperationState(session.operation_state)
    );
    const hasValidStagedSubject = Boolean(
        session.subject_id &&
        session.subject_category_id === session.category_id &&
        (
            session.subject_status === "ranking" ||
            operationKind === "random_audit"
        )
    );
    const hasValidSecondary = operationKind !== "random_audit" || Boolean(
        session.secondary_entry_id &&
        session.secondary_id &&
        session.secondary_category_id === session.category_id
    );

    return Boolean(
        session.category_exists &&
        hasValidStagedSubject &&
        hasValidRandomAuditState &&
        hasValidSecondary &&
        session.pivot_entry_id &&
        session.pivot_id &&
        session.pivot_category_id === session.category_id &&
        session.pivot_status === "active" &&
        session.pivot_rank_position !== null &&
        hasValidBounds
    );
}

async function recoverInterruptedRankingEntries(userId: string) {
    const db = getDb();
    const orphanedEntries = await all<OrphanedRankingEntryRow>(
        db
            .prepare(
                `SELECT entries.id, entries.category_id, entries.name, entries.image_key,
                (
                  SELECT ranking_sessions.source
                  FROM ranking_sessions
                  WHERE ranking_sessions.user_id = entries.user_id
                    AND (
                      ranking_sessions.subject_entry_id = entries.id OR
                      ranking_sessions.secondary_entry_id = entries.id
                    )
                  ORDER BY ranking_sessions.created_at DESC
                  LIMIT 1
                ) AS session_source
         FROM entries
         LEFT JOIN ranking_sessions
           ON ranking_sessions.user_id = entries.user_id
          AND (
            ranking_sessions.subject_entry_id = entries.id OR
            ranking_sessions.secondary_entry_id = entries.id
          )
          AND ranking_sessions.status = 'active'
         WHERE entries.user_id = ? AND entries.status = 'ranking'
           AND ranking_sessions.id IS NULL
         ORDER BY entries.created_at ASC`
            )
            .bind(userId)
    );

    if (orphanedEntries.length === 0) {
        return;
    }

    const updatedAt = now();
    const nextRankByCategory = new Map<string, number>();
    const statements: D1PreparedStatement[] = [];
    const imageKeysToDelete: string[] = [];

    for (const entry of orphanedEntries) {
        const startedQueuedEntry = await getStartedQueuedEntryForRanking(
            db,
            userId,
            entry.category_id,
            entry.name
        );

        if (entry.session_source === "new_entry" || startedQueuedEntry) {
            statements.push(
                db
                    .prepare(
                        `UPDATE entries
           SET status = 'deleted', updated_at = ?
           WHERE user_id = ? AND id = ? AND status = 'ranking'`
                    )
                    .bind(updatedAt, userId, entry.id)
            );

            if (startedQueuedEntry) {
                statements.push(
                    restoreStartedQueuedEntryStatement(
                        db,
                        userId,
                        startedQueuedEntry.id,
                        entry.category_id,
                        entry.name,
                        updatedAt
                    )
                );
            } else if (hasStoredImage(entry.image_key)) {
                imageKeysToDelete.push(entry.image_key);
            }

            continue;
        }

        let nextRank = nextRankByCategory.get(entry.category_id);
        if (nextRank === undefined) {
            nextRank = await getNextActiveRankPosition(userId, entry.category_id);
        }

        statements.push(
            db
                .prepare(
                    `UPDATE entries
           SET status = 'active', rank_position = ?, updated_at = ?
           WHERE user_id = ? AND id = ? AND status = 'ranking'`
                )
                .bind(nextRank, updatedAt, userId, entry.id)
        );
        nextRankByCategory.set(entry.category_id, nextRank + 1);
    }

    await runBatches(db, statements);
    await Promise.all(Array.from(new Set(imageKeysToDelete)).map((imageKey) => env.IMAGES.delete(imageKey)));
}

function queuedEntryStartedStatement(
    db: D1Database,
    userId: string,
    queuedEntryId: string,
    updatedAt: number
) {
    return db
        .prepare(
            `UPDATE entry_queue
       SET status = 'started', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'queued'`
        )
        .bind(updatedAt, queuedEntryId, userId);
}

async function getStartedQueuedEntryForRanking(
    db: D1Database,
    userId: string,
    categoryId: string,
    name: string
) {
    return first<{ id: string }>(
        db
            .prepare(
                `SELECT id
         FROM entry_queue
         WHERE user_id = ? AND category_id = ? AND name = ? AND status = 'started'
         ORDER BY updated_at DESC
         LIMIT 1`
            )
            .bind(userId, categoryId, name)
    );
}

function restoreStartedQueuedEntryStatement(
    db: D1Database,
    userId: string,
    queuedEntryId: string,
    categoryId: string,
    name: string,
    updatedAt: number
) {
    return db
        .prepare(
            `UPDATE entry_queue
       SET status = 'queued', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'started'
         AND NOT EXISTS (
           SELECT 1
           FROM entry_queue existing
           WHERE existing.user_id = ?
             AND existing.category_id = ?
             AND existing.name = ?
             AND existing.status = 'queued'
         )`
        )
        .bind(updatedAt, queuedEntryId, userId, userId, categoryId, name);
}

async function markQueuedEntryStarted(userId: string, queuedEntryId: string, updatedAt: number) {
    await queuedEntryStartedStatement(getDb(), userId, queuedEntryId, updatedAt).run();
}

async function prepareBinarySession(
    db: D1Database,
    input: {
        userId: string;
        categoryId: string;
        subjectEntryId: string;
        source: RankingSource;
        fromCategoryId?: string;
        opponentCount: number;
        excludedEntryId?: string;
        initialRankPosition?: number | null;
        lowerBound?: number;
        upperBound?: number;
        operationKind?: RankingOperationKind;
        secondaryEntryId?: string | null;
        secondaryOriginalRankPosition?: number | null;
        operationState?: string | null;
        createdAt: number;
    }
) {
    const opponents = await listActiveEntries(
        input.userId,
        input.categoryId,
        input.excludedEntryId
    );
    const lowerBound = input.lowerBound ?? 0;
    const upperBound = input.upperBound ?? input.opponentCount;
    if (lowerBound < 0 || upperBound > opponents.length || lowerBound >= upperBound) {
        throw new Error("Invalid ranking bounds");
    }

    const pivotIndex = chooseBinaryPivot(lowerBound, upperBound);
    const pivot = opponents[pivotIndex];
    assertOwned(pivot, "Pivot entry");

    const sessionId = newId("rank");
    return {
        sessionId,
        statement: db
            .prepare(
                `INSERT INTO ranking_sessions (
           id, user_id, category_id, subject_entry_id, source, from_category_id, lower_bound,
           upper_bound, pivot_entry_id, pivot_rank_position, final_rank_position,
           original_rank_position, status, created_at, operation_kind, secondary_entry_id,
           secondary_original_rank_position, operation_state
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?, ?)`
            )
            .bind(
                sessionId,
                input.userId,
                input.categoryId,
                input.subjectEntryId,
                input.source,
                input.fromCategoryId ?? null,
                lowerBound,
                upperBound,
                pivot.id,
                pivot.rankPosition,
                input.initialRankPosition ?? null,
                input.createdAt,
                input.operationKind ?? "single",
                input.secondaryEntryId ?? null,
                input.secondaryOriginalRankPosition ?? null,
                input.operationState ?? null
            )
    };
}

function placeRankedEntryStatements(
    db: D1Database,
    userId: string,
    entryId: string,
    categoryId: string,
    rankPosition: number,
    updatedAt: number
) {
    return [
        db
            .prepare(
                `UPDATE entries
       SET rank_position = rank_position + 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position >= ?`
            )
            .bind(updatedAt, userId, categoryId, rankPosition),
        db
            .prepare(
                `UPDATE entries
       SET status = 'active',
           rank_position = ?,
           updated_at = ?
       WHERE user_id = ? AND id = ?`
            )
            .bind(rankPosition, updatedAt, userId, entryId)
    ];
}

function normalizeOperationKind(value: string | null | undefined): RankingOperationKind {
    return value === "random_audit" ? "random_audit" : "single";
}

function parseRankingOperationState(value: string | null | undefined): RankingOperationStateEnvelope {
    if (!value) {
        return emptyRankingOperationState();
    }

    try {
        const parsed = JSON.parse(value) as Partial<RankingOperationStateEnvelope> & Partial<RandomAuditOperationState>;
        if (parsed.kind === "ranking_operation_state") {
            return {
                kind: "ranking_operation_state",
                comparisons: normalizeComparisonCache(parsed.comparisons),
                bubbleRepair: normalizeBubbleRepairState(parsed.bubbleRepair),
                randomAudit: normalizeRandomAuditState(parsed.randomAudit)
            };
        }

        const randomAudit = normalizeRandomAuditState(parsed);
        if (randomAudit) {
            return {
                ...emptyRankingOperationState(),
                randomAudit
            };
        }
    } catch {
        return emptyRankingOperationState();
    }

    return emptyRankingOperationState();
}

function serializeRankingOperationState(state: RankingOperationStateEnvelope) {
    return JSON.stringify({
        kind: "ranking_operation_state",
        comparisons: state.comparisons,
        bubbleRepair: state.bubbleRepair,
        randomAudit: state.randomAudit
    });
}

function emptyRankingOperationState(): RankingOperationStateEnvelope {
    return {
        kind: "ranking_operation_state",
        comparisons: [],
        bubbleRepair: null,
        randomAudit: null
    };
}

function randomAuditOperationState(
    randomAudit: RandomAuditOperationState
): RankingOperationStateEnvelope {
    return {
        ...emptyRankingOperationState(),
        randomAudit
    };
}

function addCachedComparison(
    state: RankingOperationStateEnvelope,
    winnerId: string,
    loserId: string
) {
    const comparisons = state.comparisons.filter((comparison) =>
        !(
            (comparison.winnerId === winnerId && comparison.loserId === loserId) ||
            (comparison.winnerId === loserId && comparison.loserId === winnerId)
        )
    );

    return {
        ...state,
        comparisons: [{ winnerId, loserId }, ...comparisons].slice(0, 200)
    };
}

function normalizeComparisonCache(value: unknown): RankingComparison[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((comparison): comparison is RankingComparison =>
            typeof comparison === "object" &&
            comparison !== null &&
            "winnerId" in comparison &&
            "loserId" in comparison &&
            typeof comparison.winnerId === "string" &&
            typeof comparison.loserId === "string"
        )
        .map((comparison) => ({
            winnerId: comparison.winnerId,
            loserId: comparison.loserId
        }))
        .slice(0, 200);
}

function normalizeBubbleRepairState(value: unknown): BubbleRepairState | null {
    if (
        typeof value !== "object" ||
        value === null ||
        !("kind" in value) ||
        value.kind !== "bubble_repair" ||
        !("stage" in value) ||
        typeof value.stage !== "string" ||
        !("workingOrderIds" in value) ||
        !Array.isArray(value.workingOrderIds) ||
        !("insertedEntryId" in value) ||
        typeof value.insertedEntryId !== "string"
    ) {
        return null;
    }

    const currentComparison = "currentComparison" in value &&
        typeof value.currentComparison === "object" &&
        value.currentComparison !== null &&
        "entryAId" in value.currentComparison &&
        "entryBId" in value.currentComparison &&
        typeof value.currentComparison.entryAId === "string" &&
        typeof value.currentComparison.entryBId === "string"
        ? {
            entryAId: value.currentComparison.entryAId,
            entryBId: value.currentComparison.entryBId
        }
        : null;

    return {
        kind: "bubble_repair",
        stage: value.stage as BubbleRepairState["stage"],
        workingOrderIds: value.workingOrderIds.filter((id): id is string => typeof id === "string"),
        insertedEntryId: value.insertedEntryId,
        aId: "aId" in value && typeof value.aId === "string" ? value.aId : null,
        bId: "bId" in value && typeof value.bId === "string" ? value.bId : null,
        dId: "dId" in value && typeof value.dId === "string" ? value.dId : null,
        eId: "eId" in value && typeof value.eId === "string" ? value.eId : null,
        currentComparison
    };
}

function parseRandomAuditOperationState(
    value: string | null | undefined
): RandomAuditOperationState | null {
    if (!value) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as Partial<RankingOperationStateEnvelope> & Partial<RandomAuditOperationState>;
        if (parsed.kind === "ranking_operation_state") {
            return normalizeRandomAuditState(parsed.randomAudit);
        }

        return normalizeRandomAuditState(parsed);
    } catch {
        return null;
    }
}

function normalizeRandomAuditState(value: unknown): RandomAuditOperationState | null {
    if (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "random_audit" &&
        "higherEntryId" in value &&
        typeof value.higherEntryId === "string" &&
        "lowerEntryId" in value &&
        typeof value.lowerEntryId === "string" &&
        "higherOriginalRankPosition" in value &&
        typeof value.higherOriginalRankPosition === "number" &&
        "lowerOriginalRankPosition" in value &&
        typeof value.lowerOriginalRankPosition === "number"
    ) {
        const bubble = "bubble" in value
            ? normalizeRandomAuditBubbleState(
                value.bubble,
                value.higherEntryId,
                value.lowerEntryId
            )
            : null;
        if (!bubble) {
            return null;
        }

        return {
            kind: "random_audit",
            higherEntryId: value.higherEntryId,
            lowerEntryId: value.lowerEntryId,
            higherOriginalRankPosition: value.higherOriginalRankPosition,
            lowerOriginalRankPosition: value.lowerOriginalRankPosition,
            bubble
        };
    }

    return null;
}

function normalizeRandomAuditBubbleState(
    value: unknown,
    higherEntryId: string,
    lowerEntryId: string
): RandomAuditBubbleState | null {
    if (
        typeof value !== "object" ||
        value === null ||
        !("kind" in value) ||
        value.kind !== "random_audit_bubble" ||
        !("stage" in value) ||
        (value.stage !== "bubble_lower_up" && value.stage !== "bubble_higher_down") ||
        !("workingOrderIds" in value) ||
        !Array.isArray(value.workingOrderIds)
    ) {
        return null;
    }

    const currentComparison = "currentComparison" in value &&
        typeof value.currentComparison === "object" &&
        value.currentComparison !== null &&
        "entryAId" in value.currentComparison &&
        "entryBId" in value.currentComparison &&
        typeof value.currentComparison.entryAId === "string" &&
        typeof value.currentComparison.entryBId === "string"
        ? {
            entryAId: value.currentComparison.entryAId,
            entryBId: value.currentComparison.entryBId
        }
        : null;

    const workingOrderIds = value.workingOrderIds.filter((id): id is string => typeof id === "string");
    if (!workingOrderIds.includes(higherEntryId) || !workingOrderIds.includes(lowerEntryId)) {
        return null;
    }

    return {
        kind: "random_audit_bubble",
        stage: value.stage,
        workingOrderIds,
        higherEntryId,
        lowerEntryId,
        currentComparison
    };
}

function clampInsertionIndex(index: number, length: number) {
    return Math.max(0, Math.min(length, Math.floor(index)));
}

function rewriteCategoryOrderStatements(
    db: D1Database,
    userId: string,
    categoryId: string,
    orderedEntryIds: string[],
    updatedAt: number
) {
    return orderedEntryIds.map((entryId, rankPosition) =>
        db
            .prepare(
                `UPDATE entries
       SET status = 'active', rank_position = ?, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND id = ?`
            )
            .bind(rankPosition, updatedAt, userId, categoryId, entryId)
    );
}

async function cancelRandomAuditSession(
    db: D1Database,
    userId: string,
    session: SessionRow,
    updatedAt: number
) {
    const state = parseRandomAuditOperationState(session.operation_state);
    if (
        !state &&
        (
            session.original_rank_position === null ||
            session.original_rank_position === undefined ||
            !session.secondary_entry_id ||
            session.secondary_original_rank_position === null ||
            session.secondary_original_rank_position === undefined
        )
    ) {
        throw new Error("Random audit session state is missing");
    }

    const activeEntries = await listActiveEntries(userId, session.category_id);
    const restoreEntries = state
        ? [
            { id: state.higherEntryId, originalRankPosition: state.higherOriginalRankPosition },
            { id: state.lowerEntryId, originalRankPosition: state.lowerOriginalRankPosition }
        ]
        : [
            {
                id: session.subject_entry_id,
                originalRankPosition: session.original_rank_position as number
            },
            {
                id: session.secondary_entry_id as string,
                originalRankPosition: session.secondary_original_rank_position as number
            }
        ].sort((left, right) => left.originalRankPosition - right.originalRankPosition);
    const restoreEntryIds = new Set(restoreEntries.map((entry) => entry.id));
    const orderedIds = activeEntries
        .map((entry) => entry.id)
        .filter((entryId) => !restoreEntryIds.has(entryId));
    for (const entry of restoreEntries) {
        orderedIds.splice(
            clampInsertionIndex(entry.originalRankPosition, orderedIds.length),
            0,
            entry.id
        );
    }

    await db.batch([
        ...rewriteCategoryOrderStatements(db, userId, session.category_id, orderedIds, updatedAt),
        db
            .prepare(
                `UPDATE ranking_sessions
         SET status = 'cancelled', completed_at = ?,
             pivot_entry_id = NULL, pivot_rank_position = NULL,
             phase = 'binary'
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(updatedAt, session.id, userId)
    ]);
}

async function getOwnedCategory(userId: string, categoryId: string) {
    return first<CategoryRow>(
        getDb()
            .prepare(
                `SELECT id, name, sort_order, created_at
         FROM categories
         WHERE user_id = ? AND id = ?`
            )
            .bind(userId, categoryId)
    );
}

async function getOwnedEntry(userId: string, entryId: string) {
    const row = await first<EntryRow>(
        getDb()
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND id = ? AND status != 'deleted'`
            )
            .bind(userId, entryId)
    );

    return row ? mapEntry(row) : null;
}

async function getOwnedEntryIncludingDeleted(userId: string, entryId: string) {
    const row = await first<EntryRow>(
        getDb()
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND id = ?`
            )
            .bind(userId, entryId)
    );

    return row ? mapEntry(row) : null;
}

async function getOwnedActiveEntry(userId: string, entryId: string) {
    const row = await first<EntryRow>(
        getDb()
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND id = ? AND status = 'active'`
            )
            .bind(userId, entryId)
    );

    return row ? mapEntry(row) : null;
}

async function listActiveEntries(userId: string, categoryId: string, excludedEntryId?: string) {
    const rows = await all<EntryRow>(
        getDb()
            .prepare(
                `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active'
           AND (? IS NULL OR id != ?)
         ORDER BY rank_position ASC`
            )
            .bind(userId, categoryId, excludedEntryId ?? null, excludedEntryId ?? null)
    );

    return rows.map(mapEntry);
}

async function getActiveEntryCount(userId: string, categoryId: string) {
    const count = await first<{ count: number }>(
        getDb()
            .prepare(
                `SELECT COUNT(*) AS count
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active'`
            )
            .bind(userId, categoryId)
    );

    return count?.count ?? 0;
}

async function getNextActiveRankPosition(userId: string, categoryId: string) {
    const row = await first<{ next_rank: number }>(
        getDb()
            .prepare(
                `SELECT COALESCE(MAX(rank_position) + 1, 0) AS next_rank
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active'`
            )
            .bind(userId, categoryId)
    );

    return row?.next_rank ?? 0;
}

function mapEntry(row: EntryRow): Entry {
    return {
        id: row.id,
        categoryId: row.category_id,
        name: row.name,
        rankPosition: row.rank_position,
        imageKey: row.image_key,
        createdAt: row.created_at,
        firstConsumedAt: row.first_consumed_at
    };
}

function mapQueuedEntry(row: QueuedEntryRow): QueuedEntry {
    return {
        id: row.id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        name: row.name,
        imageKey: row.image_key,
        firstConsumedAt: row.first_consumed_at,
        availableAt: row.available_at,
        createdAt: row.created_at
    };
}
