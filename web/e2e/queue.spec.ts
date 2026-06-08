import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { gotoApp, seedUsers, signInViaApi, winMatchups } from "./helpers";

const QUINN = {
    email: "quinn@e2e.test",
    name: "Quinn",
    categories: [{ name: "Movies", entries: ["Arrival", "Dune"] }]
};

/** Opens the account menu's Settings flyout (queue toggles + delay days). */
async function openQueueSettings(page: Page) {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Queue entries")).toBeVisible();
}

/** Closes the account menu by clicking outside of it. */
async function closeAccountMenu(page: Page) {
    await page.getByRole("heading", { name: "Movies" }).click();
    await expect(page.getByLabel("Queue entries")).toBeHidden();
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
        await page.getByLabel("Queue entries").check();
        await expect(page.getByLabel("Queue entries")).toBeChecked();
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
        await page.getByRole("button", { name: "Rename" }).click();
        await page.getByLabel("Rename Solaris").fill("Stalker");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(queueItem(page, "Stalker")).toBeVisible();
        await expect(queueItem(page, "Solaris")).toBeHidden();

        // --- "Rank Now" overrides the delay and starts a binary session. ---
        await queueItem(page, "Stalker").click({ button: "right" });
        await page.getByRole("button", { name: "Rank Now" }).click();
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });
        await winMatchups(page, "Stalker");

        await expect(page.getByText("#1 Stalker")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#2 Arrival")).toBeVisible();
        await expect(page.getByText("#3 Dune")).toBeVisible();
        await expect(page.getByText("0 queued")).toBeVisible();

        // --- With a zero-day delay, queued entries are ready immediately. ---
        await openQueueSettings(page);
        await page.getByLabel("Delay days").fill("0");
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
        await page.getByRole("button", { name: "Remove" }).click();
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
        await page.getByLabel("Queue entries").uncheck();
        await expect(page.getByLabel("Queue entries")).not.toBeChecked();
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
