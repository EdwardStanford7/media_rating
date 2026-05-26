import { auth } from "@/lib/server/auth";
import { first, getDb, now } from "@/lib/server/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;

export const Route = createFileRoute("/api/images/$entryId")({
    server: {
        handlers: {
            GET: async ({
                request,
                params
            }: {
                request: Request;
                params: { entryId: string };
            }) => {
                const session = await auth.api.getSession({ headers: request.headers });
                if (!session?.user) {
                    return new Response("Unauthorized", { status: 401 });
                }

                const entry = await first<{ image_key: string | null }>(
                    getDb()
                        .prepare(
                            `SELECT image_key
               FROM entries
               WHERE id = ? AND user_id = ? AND status != 'deleted'`
                        )
                        .bind(params.entryId, session.user.id)
                );

                if (!entry?.image_key) {
                    return new Response("Not found", { status: 404 });
                }

                const image = await env.IMAGES.get(entry.image_key);
                if (!image?.body) {
                    await getDb()
                        .prepare(
                            `UPDATE entries
               SET image_key = NULL, updated_at = ?
               WHERE id = ? AND user_id = ?`
                        )
                        .bind(now(), params.entryId, session.user.id)
                        .run();
                    return new Response("Not found", { status: 404 });
                }

                return new Response(image.body, {
                    headers: {
                        "content-type": image.httpMetadata?.contentType ?? "image/png",
                        "cache-control": "private, max-age=3600"
                    }
                });
            },
            POST: async ({
                request,
                params
            }: {
                request: Request;
                params: { entryId: string };
            }) => {
                const session = await auth.api.getSession({ headers: request.headers });
                if (!session?.user) {
                    return Response.json({ message: "Unauthorized" }, { status: 401 });
                }

                const entry = await first<{ id: string; image_key: string | null }>(
                    getDb()
                        .prepare(
                            `SELECT id, image_key
               FROM entries
               WHERE id = ? AND user_id = ? AND status != 'deleted'`
                        )
                        .bind(params.entryId, session.user.id)
                );

                if (!entry) {
                    return Response.json({ message: "Entry not found" }, { status: 404 });
                }

                const contentType = request.headers.get("content-type") ?? "";
                if (!contentType.startsWith("image/")) {
                    return Response.json({ message: "Expected an image upload" }, { status: 415 });
                }

                const image = await request.arrayBuffer();
                if (image.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
                    return Response.json({ message: "Image is too large" }, { status: 413 });
                }

                const imageKey = `${session.user.id}/entries/${entry.id}.png`;
                await env.IMAGES.put(imageKey, image, {
                    httpMetadata: {
                        contentType
                    }
                });

                await getDb()
                    .prepare(
                        `UPDATE entries
             SET image_key = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
                    )
                    .bind(imageKey, now(), entry.id, session.user.id)
                    .run();

                return Response.json({ imageKey });
            },
            DELETE: async ({
                request,
                params
            }: {
                request: Request;
                params: { entryId: string };
            }) => {
                const session = await auth.api.getSession({ headers: request.headers });
                if (!session?.user) {
                    return Response.json({ message: "Unauthorized" }, { status: 401 });
                }

                const entry = await first<{ id: string; image_key: string | null }>(
                    getDb()
                        .prepare(
                            `SELECT id, image_key
               FROM entries
               WHERE id = ? AND user_id = ? AND status != 'deleted'`
                        )
                        .bind(params.entryId, session.user.id)
                );

                if (!entry) {
                    return Response.json({ message: "Entry not found" }, { status: 404 });
                }

                if (entry.image_key) {
                    await env.IMAGES.delete(entry.image_key);
                }

                await getDb()
                    .prepare(
                        `UPDATE entries
             SET image_key = NULL, updated_at = ?
             WHERE id = ? AND user_id = ?`
                    )
                    .bind(now(), entry.id, session.user.id)
                    .run();

                return Response.json({ ok: true });
            }
        }
    }
});
