import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// E2E variant of vite.config.ts: isolated wrangler state + TEST_MODE vars
// via wrangler.e2e.jsonc, served on a separate port so it can run alongside
// the regular dev server.
export default defineConfig({
  server: {
    port: 3100,
    strictPort: true
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    cloudflare({
      configPath: "./wrangler.e2e.jsonc",
      viteEnvironment: { name: "ssr" },
      persistState: { path: ".wrangler/e2e-state" }
    }),
    tanstackStart(),
    react(),
    tailwindcss()
  ]
});
