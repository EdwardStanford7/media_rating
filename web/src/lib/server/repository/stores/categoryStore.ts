import { first, getDb } from "../../db";

export interface CategoryRow {
    id: string;
    name: string;
    sort_order: number;
    created_at: number;
    is_public?: number;
}

export async function getOwnedCategory(userId: string, categoryId: string) {
    return first<CategoryRow>(
        getDb()
            .prepare(
                `SELECT id, name, sort_order, created_at, is_public
         FROM categories
         WHERE user_id = ? AND id = ?`
            )
            .bind(userId, categoryId)
    );
}

export function rewriteUserCategoryOrderStatements(
    db: D1Database,
    userId: string,
    orderedCategoryIds: string[],
    updatedAt: number
) {
    return orderedCategoryIds.map((categoryId, sortOrder) =>
        db
            .prepare(
                `UPDATE categories
       SET sort_order = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
            )
            .bind(sortOrder, updatedAt, userId, categoryId)
    );
}
