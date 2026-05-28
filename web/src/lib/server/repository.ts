import {
    DEFAULT_ELO,
    chooseBinaryPivot,
    eloKFactorForMatchCount,
    matchCount,
    normalizeStarRatingCurve,
    orderEntries,
    rankPriorElo,
    rebaseEloForRankChange,
    selectFreeRankMatchup,
    updateEloPair
} from "@/lib/ranking";
import type {
    ActiveBinarySession,
    BinarySessionView,
    CategoryWithEntries,
    DashboardData,
    DisplayMode,
    Entry,
    FreeRankMatchup,
    ParsedImport,
    QueuedEntry,
    QueueSettings,
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
}

interface EntryRow {
    id: string;
    category_id: string;
    name: string;
    rank_position: number;
    image_key: string | null;
    created_at: number;
    first_consumed_at: number | null;
    free_rank_elo: number;
    free_rank_wins: number;
    free_rank_losses: number;
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
    created_at: number;
}

interface ActiveBinarySessionRow {
    id: string;
    category_id: string;
    category_name: string;
    subject_name: string;
    source: RankingSource;
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

export async function loadDashboard(
    userId: string,
    displayMode: DisplayMode
): Promise<DashboardData> {
    const db = getDb();
    await repairInterruptedRankingState(userId);
    const queueSettings = await getQueueSettings(userId);
    const queuedEntries = await listQueuedEntries(userId);
    const activeBinarySession = await getActiveBinarySession(userId);
    const categories = await all<CategoryRow>(
        db
            .prepare(
                `SELECT id, name, sort_order, created_at
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
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
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
            entries: orderEntries(entriesByCategory.get(category.id) ?? [], displayMode)
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
            .prepare(`DELETE FROM matches WHERE user_id = ? AND category_id = ?`)
            .bind(userId, categoryId),
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
           created_at, first_consumed_at, free_rank_elo, free_rank_wins,
           free_rank_losses, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
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
                DEFAULT_ELO,
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
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position = ?`
            )
            .bind(userId, entry.categoryId, targetRankPosition)
    );
    if (!neighbor) {
        return { moved: false };
    }

    const updatedAt = now();
    const categorySize = await getActiveEntryCount(userId, entry.categoryId);
    const entryElo = rebaseEloForRankChange(
        entry.freeRankElo,
        entry.rankPosition,
        categorySize,
        targetRankPosition,
        categorySize
    );
    const neighborElo = rebaseEloForRankChange(
        neighbor.free_rank_elo,
        neighbor.rank_position,
        categorySize,
        entry.rankPosition,
        categorySize
    );
    await db.batch([
        db
            .prepare(
                `UPDATE entries
         SET rank_position = ?, free_rank_elo = ?, updated_at = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`
            )
            .bind(targetRankPosition, entryElo, updatedAt, userId, entry.id),
        db
            .prepare(
                `UPDATE entries
         SET rank_position = ?, free_rank_elo = ?, updated_at = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`
            )
            .bind(entry.rankPosition, neighborElo, updatedAt, userId, neighbor.id)
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
                final_rank_position, created_at
         FROM ranking_sessions
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(sessionId, userId)
    );

    if (!session?.pivot_entry_id) {
        return null;
    }

    const category = await getOwnedCategory(userId, session.category_id);
    const subject = await getOwnedEntry(userId, session.subject_entry_id);
    const opponent = await getOwnedEntry(userId, session.pivot_entry_id);
    const comparisonCount = await first<{ count: number }>(
        db
            .prepare(
                `SELECT COUNT(*) AS count
         FROM matches
         WHERE user_id = ? AND ranking_session_id = ?`
            )
            .bind(userId, sessionId)
    );

    if (!category || !subject || !opponent) {
        return null;
    }

    return {
        id: session.id,
        categoryId: session.category_id,
        categoryName: category.name,
        source: session.source,
        subject,
        opponent,
        lowerBound: session.lower_bound,
        upperBound: session.upper_bound,
        comparisonCount: comparisonCount?.count ?? 0
    };
}

export async function cancelBinarySession(userId: string, sessionId: string) {
    const db = getDb();
    const session = await first<SessionRow>(
        db
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, lower_bound,
                upper_bound, pivot_entry_id, pivot_rank_position, from_category_id,
                final_rank_position, created_at
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
    const statements: D1PreparedStatement[] = [
        db
            .prepare(
                `DELETE FROM matches
         WHERE user_id = ? AND ranking_session_id = ?`
            )
            .bind(userId, session.id),
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
        const restoreRankPosition = session.final_rank_position ?? await getNextActiveRankPosition(
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
                final_rank_position, created_at
         FROM ranking_sessions
         WHERE id = ? AND user_id = ? AND status = 'active'`
            )
            .bind(input.sessionId, userId)
    );
    assertOwned(session, "Ranking session");

    if (!session.pivot_entry_id || session.pivot_rank_position === null) {
        throw new Error("Ranking session has no active matchup");
    }

    if (
        input.winnerId !== session.subject_entry_id &&
        input.winnerId !== session.pivot_entry_id
    ) {
        throw new Error("Winner must be one of the active matchup entries");
    }

    const createdAt = now();
    const matchStatement = db
        .prepare(
            `INSERT INTO matches (
         id, user_id, category_id, entry_a_id, entry_b_id, winner_id,
         match_type, ranking_session_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'binary_search', ?, ?)`
        )
        .bind(
            newId("match"),
            userId,
            session.category_id,
            session.subject_entry_id,
            session.pivot_entry_id,
            input.winnerId,
            session.id,
            createdAt
        );

    const subjectWon = input.winnerId === session.subject_entry_id;
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
            matchStatement,
            db
                .prepare(
                    `UPDATE ranking_sessions
         SET lower_bound = ?, upper_bound = ?, pivot_entry_id = ?,
             pivot_rank_position = ?
         WHERE id = ? AND user_id = ?`
                )
                .bind(lowerBound, upperBound, pivot.id, pivot.rankPosition, session.id, userId)
        ]);

        return { kind: "session" as const, sessionId: session.id };
    }

    const subject = await getOwnedEntry(userId, session.subject_entry_id);
    assertOwned(subject, "Entry");
    const finalCategorySize = await getActiveEntryCount(userId, session.category_id) + 1;
    const freeRankElo = freeRankEloForBinaryPlacement(
        session,
        subject,
        lowerBound,
        finalCategorySize
    );

    await db.batch([
        matchStatement,
        ...placeRankedEntryStatements(
            db,
            userId,
            session.subject_entry_id,
            session.category_id,
            lowerBound,
            createdAt,
            freeRankElo
        ),
        db
            .prepare(
                `UPDATE ranking_sessions
       SET status = 'completed', final_rank_position = ?, completed_at = ?,
           pivot_entry_id = NULL, pivot_rank_position = NULL
       WHERE id = ? AND user_id = ?`
            )
            .bind(lowerBound, createdAt, session.id, userId)
    ]);

    return { kind: "completed" as const, sessionId: session.id, finalRankPosition: lowerBound };
}

export async function getFreeRankMatchup(
    userId: string,
    categorySelection: string | "any"
): Promise<FreeRankMatchup | null> {
    const dashboard = await loadDashboard(userId, "ordered list");
    return selectFreeRankMatchup(dashboard.categories, categorySelection);
}

export async function submitFreeRankWinner(
    userId: string,
    input: {
        categoryId: string;
        entryAId: string;
        entryBId: string;
        winnerId: string;
    }
) {
    const db = getDb();
    const entryA = await getOwnedActiveEntry(userId, input.entryAId);
    const entryB = await getOwnedActiveEntry(userId, input.entryBId);
    assertOwned(entryA, "First entry");
    assertOwned(entryB, "Second entry");

    if (entryA.categoryId !== input.categoryId || entryB.categoryId !== input.categoryId) {
        throw new Error("Free-rank entries must belong to the selected category");
    }

    if (entryA.categoryId !== entryB.categoryId) {
        throw new Error("Free-rank matchups cannot cross categories");
    }

    if (input.winnerId !== entryA.id && input.winnerId !== entryB.id) {
        throw new Error("Winner must be one of the matchup entries");
    }

    const entryAWon = input.winnerId === entryA.id;
    const elo = entryAWon
        ? updateEloPair(
            entryA.freeRankElo,
            entryB.freeRankElo,
            eloKFactorForMatchCount(matchCount(entryA)),
            eloKFactorForMatchCount(matchCount(entryB))
        )
        : updateEloPair(
            entryB.freeRankElo,
            entryA.freeRankElo,
            eloKFactorForMatchCount(matchCount(entryB)),
            eloKFactorForMatchCount(matchCount(entryA))
        );
    const entryAEloAfter = entryAWon ? elo.winnerElo : elo.loserElo;
    const entryBEloAfter = entryAWon ? elo.loserElo : elo.winnerElo;
    const updatedAt = now();

    await db
        .prepare(
            `UPDATE entries
       SET free_rank_elo = ?,
           free_rank_wins = free_rank_wins + ?,
           free_rank_losses = free_rank_losses + ?,
           updated_at = ?
       WHERE user_id = ? AND id = ?`
        )
        .bind(entryAEloAfter, entryAWon ? 1 : 0, entryAWon ? 0 : 1, updatedAt, userId, entryA.id)
        .run();
    await db
        .prepare(
            `UPDATE entries
       SET free_rank_elo = ?,
           free_rank_wins = free_rank_wins + ?,
           free_rank_losses = free_rank_losses + ?,
           updated_at = ?
       WHERE user_id = ? AND id = ?`
        )
        .bind(entryBEloAfter, entryAWon ? 0 : 1, entryAWon ? 1 : 0, updatedAt, userId, entryB.id)
        .run();

    await db
        .prepare(
            `INSERT INTO matches (
         id, user_id, category_id, entry_a_id, entry_b_id, winner_id,
         match_type, entry_a_elo_before, entry_b_elo_before,
         entry_a_elo_after, entry_b_elo_after, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'free_rank', ?, ?, ?, ?, ?)`
        )
        .bind(
            newId("match"),
            userId,
            input.categoryId,
            entryA.id,
            entryB.id,
            input.winnerId,
            entryA.freeRankElo,
            entryB.freeRankElo,
            entryAEloAfter,
            entryBEloAfter,
            updatedAt
        )
        .run();

    return { entryAEloAfter, entryBEloAfter };
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
        const finalCategorySize = rankPosition + insertableEntries.length;

        for (const entry of insertableEntries) {
            const entryId = newId("entry");
            entryInsertStatements.push(
                db.prepare(
                    `INSERT OR IGNORE INTO entries (
             id, user_id, category_id, name, rank_position, status, image_key,
             created_at, first_consumed_at, free_rank_elo, free_rank_wins,
             free_rank_losses, updated_at
           )
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, 0, ?)`
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
                        rankPriorElo(rankPosition, finalCategorySize),
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
                ranking_sessions.source
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
            source: row.source
        }
        : null;
}

async function getActiveSessionRow(userId: string) {
    return first<SessionRow>(
        getDb()
            .prepare(
                `SELECT id, user_id, category_id, subject_entry_id, source, from_category_id,
                lower_bound, upper_bound, pivot_entry_id, pivot_rank_position,
                final_rank_position, created_at
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
                ranking_sessions.created_at,
                categories.id AS category_exists,
                subject.id AS subject_id, subject.name AS subject_name,
                subject.category_id AS subject_category_id,
                subject.image_key AS subject_image_key,
                subject.status AS subject_status,
                pivot.id AS pivot_id, pivot.category_id AS pivot_category_id,
                pivot.status AS pivot_status
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

        statements.push(
            db
                .prepare(
                    `DELETE FROM matches
           WHERE user_id = ? AND ranking_session_id = ?`
                )
                .bind(userId, session.id),
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
    return Boolean(
        session.category_exists &&
        session.subject_id &&
        session.subject_category_id === session.category_id &&
        session.subject_status === "ranking" &&
        session.pivot_entry_id &&
        session.pivot_id &&
        session.pivot_category_id === session.category_id &&
        session.pivot_status === "active" &&
        session.pivot_rank_position !== null &&
        session.lower_bound >= 0 &&
        session.upper_bound > session.lower_bound
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
                    AND ranking_sessions.subject_entry_id = entries.id
                  ORDER BY ranking_sessions.created_at DESC
                  LIMIT 1
                ) AS session_source
         FROM entries
         LEFT JOIN ranking_sessions
           ON ranking_sessions.user_id = entries.user_id
          AND ranking_sessions.subject_entry_id = entries.id
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
        createdAt: number;
    }
) {
    const opponents = await listActiveEntries(
        input.userId,
        input.categoryId,
        input.excludedEntryId
    );
    const pivotIndex = chooseBinaryPivot(0, input.opponentCount);
    const pivot = opponents[pivotIndex];
    assertOwned(pivot, "Pivot entry");

    const sessionId = newId("rank");
    return {
        sessionId,
        statement: db
            .prepare(
                `INSERT INTO ranking_sessions (
           id, user_id, category_id, subject_entry_id, source, from_category_id, lower_bound,
           upper_bound, pivot_entry_id, pivot_rank_position, final_rank_position, status, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', ?)`
            )
            .bind(
                sessionId,
                input.userId,
                input.categoryId,
                input.subjectEntryId,
                input.source,
                input.fromCategoryId ?? null,
                input.opponentCount,
                pivot.id,
                pivot.rankPosition,
                input.initialRankPosition ?? null,
                input.createdAt
            )
    };
}

function placeRankedEntryStatements(
    db: D1Database,
    userId: string,
    entryId: string,
    categoryId: string,
    rankPosition: number,
    updatedAt: number,
    freeRankElo: number | null = null
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
           free_rank_elo = COALESCE(?, free_rank_elo),
           updated_at = ?
       WHERE user_id = ? AND id = ?`
            )
            .bind(rankPosition, freeRankElo, updatedAt, userId, entryId)
    ];
}

function freeRankEloForBinaryPlacement(
    session: SessionRow,
    entry: Entry,
    finalRankPosition: number,
    finalCategorySize: number
) {
    if (session.source === "new_entry") {
        return rankPriorElo(finalRankPosition, finalCategorySize);
    }

    if (session.source === "rerank_entry") {
        return rebaseEloForRankChange(
            entry.freeRankElo,
            session.final_rank_position ?? entry.rankPosition,
            finalCategorySize,
            finalRankPosition,
            finalCategorySize
        );
    }

    if (session.source === "switch_category" && matchCount(entry) === 0) {
        return rankPriorElo(finalRankPosition, finalCategorySize);
    }

    return null;
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
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
         FROM entries
         WHERE user_id = ? AND id = ? AND status != 'deleted'`
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
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
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
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
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
        firstConsumedAt: row.first_consumed_at,
        freeRankElo: row.free_rank_elo,
        freeRankWins: row.free_rank_wins,
        freeRankLosses: row.free_rank_losses
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
