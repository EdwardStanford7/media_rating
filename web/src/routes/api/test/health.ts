import { createFileRoute } from "@tanstack/react-router";
import { testModeGate } from "@/server/lib/testMode";

export const Route = createFileRoute("/api/test/health")({
    server: {
        handlers: {
            GET: async () => testModeGate() ?? Response.json({ ok: true })
        }
    }
});
