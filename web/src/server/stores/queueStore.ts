import type { QueuedEntry, QueueSettings } from "@/lib/types";
import { all, first, getDb } from "@/server/lib/db";

export const DEFAULT_QUEUE_DELAY_DAYS = 0;
export const DEFAULT_QUEUE_ENABLED = true;
export const MAX_QUEUE_DELAY_DAYS = 365;

interface QueueSettingsRow {
    enabled: number;
    delay_days: number;
    prompt_missing_images: number;
    randomize_ready_entries: number;
}

export interface QueuedEntryRow {
    id: string;
    category_id: string;
    category_name: string;
    name: string;
    image_key: string | null;
    available_at: number;
    created_at: number;
}

export interface QueuedEntryStatusRow extends QueuedEntryRow {
    status: string;
}

export async function getQueueSettings(userId: string): Promise<QueueSettings> {
    const row = await first<QueueSettingsRow>(
        getDb()
            .prepare(
                `SELECT enabled, delay_days, prompt_missing_images, randomize_ready_entries
         FROM queue_settings
         WHERE user_id = ?`
            )
            .bind(userId)
    );

    return {
        enabled: row ? row.enabled === 1 : DEFAULT_QUEUE_ENABLED,
        delayDays: normalizeQueueDelayDays(row?.delay_days ?? DEFAULT_QUEUE_DELAY_DAYS),
        promptForMissingImages: row?.prompt_missing_images !== 0,
        randomizeReadyEntries: row?.randomize_ready_entries === 1
    };
}

export async function listQueuedEntries(userId: string): Promise<QueuedEntry[]> {
    const rows = await all<QueuedEntryRow>(
        getDb()
            .prepare(
                `SELECT entry_queue.id, entry_queue.category_id, categories.name AS category_name,
                entry_queue.name, entry_queue.image_key, entry_queue.available_at, entry_queue.created_at
         FROM entry_queue
         INNER JOIN categories ON categories.id = entry_queue.category_id
         WHERE entry_queue.user_id = ? AND entry_queue.status = 'queued'
         ORDER BY entry_queue.available_at ASC, entry_queue.created_at ASC`
            )
            .bind(userId)
    );

    return rows.map(mapQueuedEntry);
}

export async function getOwnedQueuedEntry(userId: string, queuedEntryId: string) {
    const row = await first<QueuedEntryRow>(
        getDb()
            .prepare(
                `SELECT entry_queue.id, entry_queue.category_id, categories.name AS category_name,
                entry_queue.name, entry_queue.image_key, entry_queue.available_at, entry_queue.created_at
         FROM entry_queue
         INNER JOIN categories ON categories.id = entry_queue.category_id
         WHERE entry_queue.id = ? AND entry_queue.user_id = ? AND entry_queue.status = 'queued'`
            )
            .bind(queuedEntryId, userId)
    );

    return row ? mapQueuedEntry(row) : null;
}

export async function getOwnedQueuedEntryIncludingDeleted(userId: string, queuedEntryId: string) {
    return first<QueuedEntryStatusRow>(
        getDb()
            .prepare(
                `SELECT entry_queue.id, entry_queue.category_id, categories.name AS category_name,
                entry_queue.name, entry_queue.image_key, entry_queue.available_at, entry_queue.created_at,
                entry_queue.status
         FROM entry_queue
         INNER JOIN categories ON categories.id = entry_queue.category_id
         WHERE entry_queue.id = ? AND entry_queue.user_id = ?`
            )
            .bind(queuedEntryId, userId)
    );
}

export function queuedEntryStartedStatement(
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

export async function markQueuedEntryStarted(userId: string, queuedEntryId: string, updatedAt: number) {
    await queuedEntryStartedStatement(getDb(), userId, queuedEntryId, updatedAt).run();
}

export function consumeQueuedEntryStatement(
    db: D1Database,
    userId: string,
    queuedEntryId: string
) {
    return db
        .prepare(
            `DELETE FROM entry_queue
       WHERE id = ? AND user_id = ? AND status IN ('queued', 'started')`
        )
        .bind(queuedEntryId, userId);
}

export async function getStartedQueuedEntryForRanking(
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

export function restoreStartedQueuedEntryStatement(
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

export function normalizeQueueDelayDays(value: number) {
    if (!Number.isFinite(value)) {
        return DEFAULT_QUEUE_DELAY_DAYS;
    }

    return Math.max(0, Math.min(MAX_QUEUE_DELAY_DAYS, Math.floor(value)));
}

function mapQueuedEntry(row: QueuedEntryRow): QueuedEntry {
    return {
        id: row.id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        name: row.name,
        imageKey: row.image_key,
        availableAt: row.available_at,
        createdAt: row.created_at
    };
}
