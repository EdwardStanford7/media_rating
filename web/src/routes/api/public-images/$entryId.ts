import { hasStoredImage } from "@/lib/images";
import { first, getDb } from "@/lib/server/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/public-images/$entryId")({
    server: {
        handlers: {
            GET: async ({ params }: { params: { entryId: string } }) => {
                const entry = await first<{ image_key: string | null }>(
                    getDb()
                        .prepare(
                            `SELECT entries.image_key
               FROM entries
               INNER JOIN categories ON categories.id = entries.category_id
               INNER JOIN user_profiles ON user_profiles.user_id = entries.user_id
               WHERE entries.id = ?
                 AND entries.status = 'active'
                 AND categories.user_id = entries.user_id
                 AND categories.is_public = 1
                 AND user_profiles.is_public = 1`
                        )
                        .bind(params.entryId)
                );

                const imageKey = entry?.image_key ?? null;
                if (!hasStoredImage(imageKey)) {
                    return new Response("Not found", { status: 404 });
                }

                const image = await env.IMAGES.get(imageKey);
                if (!image?.body) {
                    return new Response("Not found", { status: 404 });
                }

                return new Response(image.body, {
                    headers: {
                        "content-type": image.httpMetadata?.contentType ?? "image/jpeg",
                        "cache-control": "no-store"
                    }
                });
            }
        }
    }
});
