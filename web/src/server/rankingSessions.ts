import { createServerFn } from "@tanstack/react-start";
import {
    advanceBubbleRepairState,
    chooseBinaryPivot,
    startBubbleRepairState
} from "@/lib/ranking";
import type {
    ActiveBinarySession,
    BinarySessionView,
    Entry,
    RankingOperationKind,
    RankingSource
} from "@/lib/types";
import { env } from "cloudflare:workers";
import { hasStoredImage } from "@/lib/images";
import { all, assertOwned, first, getDb, newId, now, runBatches } from "@/server/lib/db";
import { authMiddleware } from "@/server/middleware/auth";
import { getOwnedCategory } from "./stores/categoryStore";
import {
    getNextActiveRankPosition,
    getOwnedEntry,
    listActiveEntries,
    placeRankedEntryStatements,
    rewriteCategoryOrderStatements
} from "./stores/entryStore";
import {
    restoreStartedQueuedEntryStatement
} from "./stores/queueStore";
import {
    type RankingOperationStateEnvelope,
    addCachedComparison,
    clampInsertionIndex,
    normalizeOperationKind,
    parseRankingOperationState,
    serializeRankingOperationState
} from "./engine/rankingState";
import {
    type SessionRow,
    repairInterruptedRankingState,
    startBubbleRepairOrCommit,
    submitBubbleRepairWinner,
    submitLocalRepairWinner
} from "./engine/rankingSessions";

export const getBinarySession = createServerFn({ method: "GET" })
    .middleware([authMiddleware])
    .inputValidator((data: { sessionId: string }) => data)
    .handler(async ({ context, data }) => {
        const userId = context.user.id;
        const { sessionId } = data;
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
        const repairComparison = session.phase === "bubble_repair"
            ? operationState.bubbleRepair?.currentComparison ?? null
            : null;
        const activeComparison = repairComparison;
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
    });

export const cancelBinarySession = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { sessionId: string }) => data)
    .handler(async ({ context, data }) => {
        const userId = context.user.id;
        const { sessionId } = data;
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

        const operationState = parseRankingOperationState(session.operation_state);
        const queuedEntryId = operationState.queuedEntryId;
        statements.push(
            db
                .prepare(
                    `UPDATE entries
             SET status = 'deleted', updated_at = ?
             WHERE id = ? AND user_id = ? AND status = 'ranking'`
                )
                .bind(updatedAt, session.subject_entry_id, userId)
        );

        if (queuedEntryId) {
            statements.push(
                restoreStartedQueuedEntryStatement(
                    db,
                    userId,
                    queuedEntryId,
                    session.category_id,
                    entry.name,
                    updatedAt
                )
            );
        }

        await db.batch(statements);
        if (!queuedEntryId && hasStoredImage(entry.imageKey)) {
            await env.IMAGES.delete(entry.imageKey);
        }
    });

export const submitBinaryWinner = createServerFn({ method: "POST" })
    .middleware([authMiddleware])
    .inputValidator((data: { sessionId: string; winnerId: string }) => data)
    .handler(async ({ context, data: input }) => {
        const userId = context.user.id;
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

        return startBubbleRepairOrCommit(
            db,
            userId,
            session,
            lowerBound,
            createdAt,
            nextOperationState,
            true
        );
    });
