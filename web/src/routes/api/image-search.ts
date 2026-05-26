import { auth } from "@/lib/server/auth";
import { first, getDb } from "@/lib/server/db";
import { searchImageCandidates } from "@/lib/server/imageSearch";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image-search")({
    server: {
        handlers: {
            GET: async ({ request }: { request: Request }) => {
                const session = await auth.api.getSession({ headers: request.headers });
                if (!session?.user) {
                    return Response.json({ message: "Unauthorized" }, { status: 401 });
                }

                const url = new URL(request.url);
                const entryId = url.searchParams.get("entryId") ?? "";
                const query = url.searchParams.get("query") ?? "";

                const entry = await first<{ name: string; category_name: string }>(
                    getDb()
                        .prepare(
                            `SELECT entries.name, categories.name AS category_name
               FROM entries
               INNER JOIN categories ON categories.id = entries.category_id
               WHERE entries.id = ? AND entries.user_id = ? AND entries.status != 'deleted'`
                        )
                        .bind(entryId, session.user.id)
                );

                if (!entry) {
                    return Response.json({ message: "Entry not found" }, { status: 404 });
                }

                const searchQuery = query.trim() || `${entry.name} (${entry.category_name})`;

                try {
                    return Response.json({
                        candidates: await searchImageCandidates(searchQuery)
                    });
                } catch (error) {
                    return Response.json(
                        { message: error instanceof Error ? error.message : "Image search failed" },
                        { status: 502 }
                    );
                }
            }
        }
    }
});
