import { orderEntries } from "@/lib/ranking";
import type { DashboardData, Entry } from "@/lib/types";
import { all, getDb } from "../db";
import { type CategoryRow } from "./stores/categoryStore";
import { type EntryRow, mapEntry } from "./stores/entryStore";
import { getQueueSettings, listQueuedEntries } from "./stores/queueStore";
import { ensureUserProfile, mapCurrentUserProfile } from "./profiles";
import { getActiveBinarySession, repairInterruptedRankingState } from "./rankingSessions";
import { purgeExpiredDeletedItems } from "./maintenance";

export async function loadDashboard(userId: string): Promise<DashboardData> {
    const db = getDb();
    await repairInterruptedRankingState(userId);
    await purgeExpiredDeletedItems(userId);
    const profile = await ensureUserProfile(userId);
    const queueSettings = await getQueueSettings(userId);
    const queuedEntries = await listQueuedEntries(userId);
    const activeBinarySession = await getActiveBinarySession(userId);
    const categories = await all<CategoryRow>(
        db
            .prepare(
                `SELECT id, name, sort_order, created_at, is_public
         FROM categories
         WHERE user_id = ?
         ORDER BY sort_order ASC, name ASC`
            )
            .bind(userId)
    );

    if (categories.length === 0) {
        return {
            categories: [],
            queueSettings,
            queuedEntries,
            activeBinarySession,
            profile: mapCurrentUserProfile(profile)
        };
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
            isPublic: Boolean(category.is_public),
            entries: orderEntries(entriesByCategory.get(category.id) ?? [])
        })),
        queueSettings,
        queuedEntries,
        activeBinarySession,
        profile: mapCurrentUserProfile(profile)
    };
}
