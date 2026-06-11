import { createFileRoute } from "@tanstack/react-router";
import { all, getDb } from "@/server/lib/db";
import { testModeGate } from "@/server/lib/testMode";

export const Route = createFileRoute("/api/test/admin-audit")({
    server: {
        handlers: {
            GET: async ({ request }: { request: Request }) => {
                const gated = testModeGate();
                if (gated) {
                    return gated;
                }

                const url = new URL(request.url);
                const targetUserId = url.searchParams.get("targetUserId") ?? "";
                const action = url.searchParams.get("action") ?? "";
                const where: string[] = [];
                const params: string[] = [];
                if (targetUserId) {
                    where.push("target_user_id = ?");
                    params.push(targetUserId);
                }
                if (action) {
                    where.push("action = ?");
                    params.push(action);
                }

                const rows = await all(
                    getDb()
                        .prepare(
                            `SELECT id, actor_user_id, actor_label, target_user_id, action,
                              reason, metadata_json, created_at
                     FROM admin_audit_events
                     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
                     ORDER BY created_at DESC`
                        )
                        .bind(...params)
                );

                return Response.json({ rows });
            }
        }
    }
});
