import { createFileRoute } from "@tanstack/react-router";
import { all, first, getDb, now } from "@/server/lib/db";
import { testModeGate } from "@/server/lib/testMode";

export const Route = createFileRoute("/api/test/stale-ranking")({
    server: {
        handlers: {
            POST: async ({ request }) => {
                const gated = testModeGate();
                if (gated) {
                    return gated;
                }

                const body = await request.json().catch(() => ({})) as { email?: string };
                const email = body.email?.trim();
                if (!email) {
                    return Response.json({ error: "email is required" }, { status: 400 });
                }

                const db = getDb();
                const user = await first<{ id: string }>(
                    db.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(email)
                );
                if (!user) {
                    return Response.json({ error: "user not found" }, { status: 404 });
                }

                const sessions = await all<{ id: string }>(
                    db
                        .prepare(
                            `SELECT id
                 FROM ranking_sessions
                 WHERE user_id = ? AND status = 'active'`
                        )
                        .bind(user.id)
                );
                const updatedAt = now();
                if (sessions.length > 0) {
                    await db.batch(sessions.map((session) =>
                        db
                            .prepare(
                                `UPDATE ranking_sessions
                 SET status = 'cancelled', completed_at = ?,
                     pivot_entry_id = NULL, pivot_rank_position = NULL
                 WHERE id = ? AND user_id = ? AND status = 'active'`
                            )
                            .bind(updatedAt, session.id, user.id)
                    ));
                }

                return Response.json({ cancelledCount: sessions.length });
            }
        }
    }
});
