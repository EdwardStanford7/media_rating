import {
  DEFAULT_ELO,
  chooseBinaryPivot,
  orderEntries,
  selectFreeRankMatchup,
  updateEloPair
} from "@/lib/ranking";
import type {
  BinarySessionView,
  CategoryWithEntries,
  DashboardData,
  DisplayMode,
  Entry,
  FreeRankMatchup,
  ParsedImport,
  RankingSource
} from "@/lib/types";
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

interface SessionRow {
  id: string;
  user_id: string;
  category_id: string;
  subject_entry_id: string;
  source: RankingSource;
  lower_bound: number;
  upper_bound: number;
  pivot_entry_id: string | null;
  pivot_rank_position: number | null;
}

export async function loadDashboard(
  userId: string,
  displayMode: DisplayMode
): Promise<DashboardData> {
  const db = getDb();
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

  const categoriesWithEntries: CategoryWithEntries[] = [];

  for (const category of categories) {
    const entryRows = await all<EntryRow>(
      db
        .prepare(
          `SELECT id, category_id, name, rank_position, image_key, created_at,
                  first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
           FROM entries
           WHERE user_id = ? AND category_id = ? AND status = 'active'
           ORDER BY rank_position ASC`
        )
        .bind(userId, category.id)
    );

    categoriesWithEntries.push({
      id: category.id,
      name: category.name,
      sortOrder: category.sort_order,
      createdAt: category.created_at,
      entries: orderEntries(entryRows.map(mapEntry), displayMode)
    });
  }

  return { categories: categoriesWithEntries };
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

export async function createEntryWithBinaryRanking(
  userId: string,
  input: {
    categoryId: string;
    name: string;
    firstConsumedAt: number | null;
  }
) {
  const db = getDb();
  const category = await getOwnedCategory(userId, input.categoryId);
  assertOwned(category, "Category");

  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error("Entry name is required");
  }

  const activeCount = await getActiveEntryCount(userId, input.categoryId);
  const createdAt = now();
  const entryId = newId("entry");
  const imageKey = `${userId}/entries/${entryId}.png`;
  const status = activeCount === 0 ? "active" : "ranking";

  await db
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
      imageKey,
      createdAt,
      input.firstConsumedAt,
      DEFAULT_ELO,
      createdAt
    )
    .run();

  if (activeCount === 0) {
    return { kind: "completed" as const, entryId, sessionId: null };
  }

  const sessionId = await createBinarySession({
    userId,
    categoryId: input.categoryId,
    subjectEntryId: entryId,
    source: "new_entry",
    opponentCount: activeCount
  });

  return { kind: "session" as const, entryId, sessionId };
}

export async function startRerankEntry(userId: string, entryId: string) {
  const db = getDb();
  const entry = await getOwnedEntry(userId, entryId);
  assertOwned(entry, "Entry");

  const activeCount = await getActiveEntryCount(userId, entry.categoryId);
  if (activeCount <= 1) {
    return { kind: "completed" as const, entryId, sessionId: null };
  }

  const updatedAt = now();
  await db
    .prepare(
      `UPDATE entries
       SET rank_position = rank_position - 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position > ?`
    )
    .bind(updatedAt, userId, entry.categoryId, entry.rankPosition)
    .run();
  await db
    .prepare(
      `UPDATE entries
       SET status = 'ranking', rank_position = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
    )
    .bind(activeCount - 1, updatedAt, userId, entryId)
    .run();

  const sessionId = await createBinarySession({
    userId,
    categoryId: entry.categoryId,
    subjectEntryId: entryId,
    source: "rerank_entry",
    opponentCount: activeCount - 1
  });

  return { kind: "session" as const, entryId, sessionId };
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
  await getDb()
    .prepare(
      `UPDATE entries
       SET rank_position = rank_position - 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position > ?`
    )
    .bind(updatedAt, userId, entry.categoryId, entry.rankPosition)
    .run();
  await getDb()
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
    .run();

  if (targetCount === 0) {
    return { kind: "completed" as const, entryId: entry.id, sessionId: null };
  }

  const sessionId = await createBinarySession({
    userId,
    categoryId: input.targetCategoryId,
    subjectEntryId: entry.id,
    source: "switch_category",
    fromCategoryId: entry.categoryId,
    opponentCount: targetCount
  });

  return { kind: "session" as const, entryId: entry.id, sessionId };
}

export async function getBinarySession(
  userId: string,
  sessionId: string
): Promise<BinarySessionView | null> {
  const db = getDb();
  const session = await first<SessionRow>(
    db
      .prepare(
        `SELECT id, user_id, category_id, subject_entry_id, source, lower_bound,
                upper_bound, pivot_entry_id, pivot_rank_position
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
    subject,
    opponent,
    lowerBound: session.lower_bound,
    upperBound: session.upper_bound,
    comparisonCount: comparisonCount?.count ?? 0
  };
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
                upper_bound, pivot_entry_id, pivot_rank_position
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
  await db
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
    )
    .run();

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

    await db
      .prepare(
        `UPDATE ranking_sessions
         SET lower_bound = ?, upper_bound = ?, pivot_entry_id = ?,
             pivot_rank_position = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(lowerBound, upperBound, pivot.id, pivot.rankPosition, session.id, userId)
      .run();

    return { kind: "session" as const, sessionId: session.id };
  }

  await placeRankedEntry(userId, session.subject_entry_id, session.category_id, lowerBound);
  await db
    .prepare(
      `UPDATE ranking_sessions
       SET status = 'completed', final_rank_position = ?, completed_at = ?,
           pivot_entry_id = NULL, pivot_rank_position = NULL
       WHERE id = ? AND user_id = ?`
    )
    .bind(lowerBound, createdAt, session.id, userId)
    .run();

  return { kind: "completed" as const, sessionId: session.id, finalRankPosition: lowerBound };
}

export async function getFreeRankMatchup(
  userId: string,
  categorySelection: string | "any"
): Promise<FreeRankMatchup | null> {
  const dashboard = await loadDashboard(userId, "binary");
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
    ? updateEloPair(entryA.freeRankElo, entryB.freeRankElo)
    : updateEloPair(entryB.freeRankElo, entryA.freeRankElo);
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
  const createdAt = now();
  const categoriesByName = new Map<string, string>();
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

  let sortOrder = existingCategories.length;
  const importedByCategory = new Map<string, typeof parsedImport.entries>();

  for (const entry of parsedImport.entries) {
    const bucket = importedByCategory.get(entry.categoryName) ?? [];
    bucket.push(entry);
    importedByCategory.set(entry.categoryName, bucket);

    if (!categoriesByName.has(entry.categoryName)) {
      const categoryId = newId("cat");
      categoriesByName.set(entry.categoryName, categoryId);
      await db
        .prepare(
          `INSERT INTO categories (id, user_id, name, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(categoryId, userId, entry.categoryName, sortOrder, createdAt, createdAt)
        .run();
      sortOrder += 1;
    }
  }

  let importedCount = 0;
  for (const [categoryName, entries] of importedByCategory) {
    const categoryId = categoriesByName.get(categoryName);
    if (!categoryId) {
      continue;
    }

    entries.sort((left, right) => left.rankPosition - right.rankPosition);

    for (const entry of entries) {
      const activeCount = await getActiveEntryCount(userId, categoryId);
      const entryId = newId("entry");
      await db
        .prepare(
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
          activeCount,
          `${userId}/entries/${entryId}.png`,
          createdAt,
          entry.firstConsumedAt,
          DEFAULT_ELO,
          createdAt
        )
        .run();
      importedCount += 1;
    }
  }

  return { importedCount };
}

async function createBinarySession(input: {
  userId: string;
  categoryId: string;
  subjectEntryId: string;
  source: RankingSource;
  fromCategoryId?: string;
  opponentCount: number;
}) {
  const opponents = await listActiveEntries(input.userId, input.categoryId);
  const pivotIndex = chooseBinaryPivot(0, input.opponentCount);
  const pivot = opponents[pivotIndex];
  assertOwned(pivot, "Pivot entry");

  const createdAt = now();
  const sessionId = newId("rank");
  await getDb()
    .prepare(
      `INSERT INTO ranking_sessions (
         id, user_id, category_id, subject_entry_id, source, from_category_id, lower_bound,
         upper_bound, pivot_entry_id, pivot_rank_position, status, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?)`
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
      createdAt
    )
    .run();

  return sessionId;
}

async function placeRankedEntry(
  userId: string,
  entryId: string,
  categoryId: string,
  rankPosition: number
) {
  const db = getDb();
  const updatedAt = now();
  await db
    .prepare(
      `UPDATE entries
       SET rank_position = rank_position + 1, updated_at = ?
       WHERE user_id = ? AND category_id = ? AND status = 'active' AND rank_position >= ?`
    )
    .bind(updatedAt, userId, categoryId, rankPosition)
    .run();
  await db
    .prepare(
      `UPDATE entries
       SET status = 'active', rank_position = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
    )
    .bind(rankPosition, updatedAt, userId, entryId)
    .run();
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

async function listActiveEntries(userId: string, categoryId: string) {
  const rows = await all<EntryRow>(
    getDb()
      .prepare(
        `SELECT id, category_id, name, rank_position, image_key, created_at,
                first_consumed_at, free_rank_elo, free_rank_wins, free_rank_losses
         FROM entries
         WHERE user_id = ? AND category_id = ? AND status = 'active'
         ORDER BY rank_position ASC`
      )
      .bind(userId, categoryId)
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
