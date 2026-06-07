import type { ParsedImport } from "@/lib/types";
import { all, getDb, newId, now, runBatches } from "@/server/lib/db";
import { type CategoryRow } from "./stores/categoryStore";
import { assertNoActiveBinarySession } from "./rankingSessions";

interface ExistingEntryRow {
    category_id: string;
    name: string;
    status: string;
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
