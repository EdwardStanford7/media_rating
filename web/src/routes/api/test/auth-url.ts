import { createFileRoute } from "@tanstack/react-router";
import { testModeGate, takeAuthUrl, type CapturedAuthUrlType } from "@/server/lib/testMode";

const AUTH_URL_TYPES: CapturedAuthUrlType[] = ["reset-password"];

export const Route = createFileRoute("/api/test/auth-url")({
    server: {
        handlers: {
            GET: async ({ request }: { request: Request }) => {
                const gated = testModeGate();
                if (gated) {
                    return gated;
                }

                const url = new URL(request.url);
                const email = url.searchParams.get("email") ?? "";
                const type = url.searchParams.get("type") as CapturedAuthUrlType;
                if (!email || !AUTH_URL_TYPES.includes(type)) {
                    return Response.json({ message: "email and type are required" }, { status: 400 });
                }

                const authUrl = takeAuthUrl(type, email);
                if (!authUrl) {
                    return Response.json({ message: "No captured URL" }, { status: 404 });
                }

                return Response.json({ url: authUrl });
            }
        }
    }
});
