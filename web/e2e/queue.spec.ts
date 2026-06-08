import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { gotoApp, seedUsers, serverFnResponse, signInViaApi, winMatchups } from "./helpers";

const QUINN = {
    email: "quinn@e2e.test",
    name: "Quinn",
    categories: [{ name: "Movies", entries: ["Arrival", "Dune"] }]
};

/** Opens the account menu's Settings flyout (queue toggles + delay days). */
async function openQueueSettings(page: Page) {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Queue entries" })).toBeVisible();
}

/** Closes the account menu by clicking outside of it. */
async function closeAccountMenu(page: Page) {
    await page.getByRole("heading", { name: "Movies" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Queue entries" })).toBeHidden();
}

/**
 * Queue settings save quietly in the background: the checkbox flips
 * optimistically, but the dashboard only honors the new settings after the
 * save + refresh round-trip. Entries added before that round-trip lands are
 * routed by the OLD settings, and Playwright is fast enough to win that race
 * (~10ms window). Wrap each settings change so the test waits it out.
 */
async function withSettingsSaved(page: Page, change: () => Promise<void>) {
    const saved = serverFnResponse(page, "updateQueueSettings");
    const refreshed = serverFnResponse(page, "loadDashboard");
    await change();
    await saved;
    await refreshed;
}

/**
 * A queued entry renders its name twice (poster placeholder + row body);
 * target the first so exact-text lookups stay unambiguous. Right-clicks
 * bubble to the row's context-menu handler either way.
 */
function queueItem(page: Page, name: string) {
    return page.getByText(name, { exact: true }).first();
}

test.describe("Queue", () => {
    test("full queue lifecycle: enable, delay, rename, rank now, undo delete, rank queue, disable", async ({
        page,
        context
    }) => {
        test.setTimeout(120_000);
        await seedUsers([QUINN]);
        await signInViaApi(context, QUINN.email);
        await gotoApp(page);
        await expect(page.getByText("#1 Arrival")).toBeVisible();
        await expect(page.getByText("Queue Empty")).toBeVisible();

        // --- Enable the queue with the default delay (3 days). ---
        await openQueueSettings(page);
        await withSettingsSaved(page, () => page.getByRole("menuitemcheckbox", { name: "Queue entries" }).click());
        await expect(page.getByRole("menuitemcheckbox", { name: "Queue entries" })).toHaveAttribute("aria-checked", "true");
        await closeAccountMenu(page);

        // --- New entries now land in the queue, not ready yet. ---
        await page.getByPlaceholder("New entry").fill("Solaris");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText(/Queued Solaris for ranking on/)).toBeVisible();
        await expect(page.getByText("1 queued")).toBeVisible();
        await expect(page.getByText("0 ready")).toBeVisible();
        await expect(page.getByRole("button", { name: "Rank Queue" })).toBeDisabled();

        // --- Queue state survives a reload (server-side persistence). ---
        await gotoApp(page);
        await expect(page.getByText("1 queued")).toBeVisible();
        await expect(queueItem(page, "Solaris")).toBeVisible();

        // --- Rename the queued entry from its context menu. ---
        await queueItem(page, "Solaris").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Rename" }).click();
        await page.getByLabel("Rename Solaris").fill("Stalker");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(queueItem(page, "Stalker")).toBeVisible();
        await expect(queueItem(page, "Solaris")).toBeHidden();

        // --- "Rank Now" overrides the delay and starts a binary session. ---
        await queueItem(page, "Stalker").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Rank Now" }).click();
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });
        await winMatchups(page, "Stalker");

        await expect(page.getByText("#1 Stalker")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#2 Arrival")).toBeVisible();
        await expect(page.getByText("#3 Dune")).toBeVisible();
        await expect(page.getByText("0 queued")).toBeVisible();

        // --- With a zero-day delay, queued entries are ready immediately. ---
        await openQueueSettings(page);
        await withSettingsSaved(page, () => page.getByLabel("Delay days").fill("0"));
        await closeAccountMenu(page);

        await page.getByPlaceholder("New entry").fill("Memento");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText("1 queued")).toBeVisible();

        await page.getByPlaceholder("New entry").fill("Klute");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText("2 queued")).toBeVisible();

        // The queue panel snapshots the clock on mount and only re-checks
        // readiness once a minute, so entries queued with a zero delay show
        // as pending until then. Reload to remount with a fresh clock.
        await gotoApp(page);
        await expect(page.getByText("2 queued")).toBeVisible();
        await expect(page.getByText("2 ready")).toBeVisible();
        await expect(page.getByRole("button", { name: "Rank Queue" })).toBeEnabled();

        // --- Removing a queued entry is reversible via the undo toast. ---
        await queueItem(page, "Klute").click({ button: "right" });
        await page.getByRole("menuitem", { name: "Remove" }).click();
        await expect(page.getByText("Removed Klute from the queue.")).toBeVisible();
        await expect(page.getByText("1 queued")).toBeVisible();

        await page.getByRole("button", { name: "Undo" }).click();
        await expect(page.getByText("Restored Klute to the queue.")).toBeVisible();
        await expect(page.getByText("2 queued")).toBeVisible();

        // --- "Rank Queue" chains ranking sessions for every ready entry. ---
        await page.getByRole("button", { name: "Rank Queue" }).click();
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });
        await winMatchups(page, "Memento");
        // The second session starts automatically once the first finishes.
        await winMatchups(page, "Klute");

        await expect(page.getByText("No ready queued entries remain.")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#1 Klute")).toBeVisible();
        await expect(page.getByText("#2 Memento")).toBeVisible();
        await expect(page.getByText("#3 Stalker")).toBeVisible();
        await expect(page.getByText("#4 Arrival")).toBeVisible();
        await expect(page.getByText("#5 Dune")).toBeVisible();
        await expect(page.getByText("Queue Empty")).toBeVisible();

        // --- Disabling the queue routes new entries straight to ranking. ---
        await openQueueSettings(page);
        await withSettingsSaved(page, () => page.getByRole("menuitemcheckbox", { name: "Queue entries" }).click());
        await expect(page.getByRole("menuitemcheckbox", { name: "Queue entries" })).toHaveAttribute("aria-checked", "false");
        await closeAccountMenu(page);

        await page.getByPlaceholder("New entry").fill("Tron");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("Queue Empty")).toBeVisible();
        await winMatchups(page, "Tron");
        await expect(page.getByText("#1 Tron")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#6 Dune")).toBeVisible();
    });
});
