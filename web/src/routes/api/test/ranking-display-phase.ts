import { createFileRoute } from "@tanstack/react-router";
import type { BubbleRepairStage } from "@/lib/ranking";
import { all, first, getDb } from "@/server/lib/db";
import { emptyRankingOperationState, serializeRankingOperationState } from "@/server/engine/rankingState";
import { testModeGate } from "@/server/lib/testMode";

type TestDisplayPhase = "binary" | "placement_check" | "local_repair";

interface Body {
    email?: string;
    phase?: TestDisplayPhase;
}

interface ActiveSessionRow {
    id: string;
    category_id: string;
    subject_entry_id: string;
    pivot_entry_id: string | null;
}

interface EntryRow {
    id: string;
    rank_position: number;
}

export const Route = createFileRoute("/api/test/ranking-display-phase")({
    server: {
        handlers: {
            POST: async ({ request }: { request: Request }) => {
                const gated = testModeGate();
                if (gated) {
                    return gated;
                }

                const body = await request.json().catch(() => ({})) as Body;
                const email = body.email?.trim();
                const phase = body.phase;
                if (!email) {
                    return Response.json({ error: "email is required" }, { status: 400 });
                }
                if (phase !== "binary" && phase !== "placement_check" && phase !== "local_repair") {
                    return Response.json({ error: "valid phase is required" }, { status: 400 });
                }

                const db = getDb();
                const user = await first<{ id: string }>(
                    db.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(email)
                );
                if (!user) {
                    return Response.json({ error: "user not found" }, { status: 404 });
                }

                const session = await first<ActiveSessionRow>(
                    db
                        .prepare(
                            `SELECT id, category_id, subject_entry_id, pivot_entry_id
                 FROM ranking_sessions
                 WHERE user_id = ? AND status = 'active'
                 ORDER BY created_at DESC
                 LIMIT 1`
                        )
                        .bind(user.id)
                );
                if (!session) {
                    return Response.json({ error: "active ranking session not found" }, { status: 404 });
                }

                if (phase === "binary") {
                    await db
                        .prepare(
                            `UPDATE ranking_sessions
                 SET phase = 'binary', operation_state = ?
                 WHERE id = ? AND user_id = ? AND status = 'active'`
                        )
                        .bind(serializeRankingOperationState(emptyRankingOperationState()), session.id, user.id)
                        .run();
                    return Response.json({ ok: true, phase });
                }

                const activeEntries = await all<EntryRow>(
                    db
                        .prepare(
                            `SELECT id, rank_position
                 FROM entries
                 WHERE user_id = ? AND category_id = ? AND status = 'active'
                 ORDER BY rank_position ASC`
                        )
                        .bind(user.id, session.category_id)
                );
                if (activeEntries.length === 0) {
                    return Response.json({ error: "active entries are required" }, { status: 400 });
                }
                if (phase === "local_repair" && activeEntries.length < 2) {
                    return Response.json({ error: "at least two active entries are required" }, { status: 400 });
                }

                const stage: BubbleRepairStage = phase === "placement_check" ? "left_check" : "bubble_b_left";
                const firstEntry = activeEntries[0];
                const secondEntry = activeEntries[1] ?? firstEntry;
                const currentComparison = phase === "placement_check"
                    ? { entryAId: session.subject_entry_id, entryBId: firstEntry.id }
                    : { entryAId: secondEntry.id, entryBId: firstEntry.id };
                const workingOrderIds = activeEntries.map((entry) => entry.id);
                workingOrderIds.splice(Math.min(1, workingOrderIds.length), 0, session.subject_entry_id);

                const operationState = emptyRankingOperationState();
                operationState.bubbleRepair = {
                    kind: "bubble_repair",
                    stage,
                    workingOrderIds,
                    insertedEntryId: session.subject_entry_id,
                    aId: firstEntry.id,
                    bId: secondEntry.id,
                    dId: activeEntries[2]?.id ?? null,
                    eId: activeEntries[3]?.id ?? null,
                    currentComparison
                };

                await db
                    .prepare(
                        `UPDATE ranking_sessions
             SET phase = 'bubble_repair',
                 pivot_entry_id = ?,
                 pivot_rank_position = ?,
                 final_rank_position = ?,
                 operation_state = ?
             WHERE id = ? AND user_id = ? AND status = 'active'`
                    )
                    .bind(
                        currentComparison.entryBId,
                        firstEntry.rank_position,
                        workingOrderIds.indexOf(session.subject_entry_id),
                        serializeRankingOperationState(operationState),
                        session.id,
                        user.id
                    )
                    .run();

                return Response.json({ ok: true, phase });
            }
        }
    }
});
