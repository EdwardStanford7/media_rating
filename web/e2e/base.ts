import { test as base, expect } from "@playwright/test";
import { BASE_URL } from "./constants";

// Every test starts from an empty database. The /api/test/* endpoints only
// exist when the server runs with TEST_MODE=true (see wrangler.e2e.jsonc).
export const test = base.extend({
    page: async ({ page }, use) => {
        const response = await fetch(`${BASE_URL}/api/test/reset`, { method: "POST" });
        if (!response.ok) {
            throw new Error(`Database reset failed: ${response.status} ${await response.text()}`);
        }

        await use(page);
    }
});

export { expect };
