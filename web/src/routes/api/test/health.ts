import { createFileRoute } from "@tanstack/react-router";
import { testModeGate } from "@/lib/server/testMode";

export const Route = createFileRoute("/api/test/health")({
    server: {
        handlers: {
            GET: async () => testModeGate() ?? Response.json({ ok: true })
        }
    }
});
