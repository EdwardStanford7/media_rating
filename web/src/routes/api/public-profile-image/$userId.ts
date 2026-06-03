import { hasStoredImage } from "@/lib/images";
import { first, getDb } from "@/lib/server/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/public-profile-image/$userId")({
    server: {
        handlers: {
            GET: async ({ params }: { params: { userId: string } }) => {
                const user = await first<{ image: string | null }>(
                    getDb()
                        .prepare(
                            `SELECT "user".image
               FROM "user"
               INNER JOIN user_profiles ON user_profiles.user_id = "user".id
               WHERE "user".id = ? AND user_profiles.is_public = 1`
                        )
                        .bind(params.userId)
                );

                const imageKey = user?.image ?? null;
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
