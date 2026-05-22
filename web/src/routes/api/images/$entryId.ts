import { auth } from "@/lib/server/auth";
import { first, getDb } from "@/lib/server/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

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
          return new Response("Not found", { status: 404 });
        }

        return new Response(image.body, {
          headers: {
            "content-type": image.httpMetadata?.contentType ?? "image/png",
            "cache-control": "private, max-age=3600"
          }
        });
      }
    }
  }
});
