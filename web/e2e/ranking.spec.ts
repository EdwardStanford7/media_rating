import { test, expect } from "./base";
import { gotoApp, seedUsers, signInViaApi } from "./helpers";

const RANKER = {
    email: "ranker@e2e.test",
    name: "Ranker",
    categories: [{ name: "Movies", entries: ["Alpha", "Beta", "Gamma"] }]
};

/**
 * Plays out a binary ranking session by always picking the given entry as the
 * winner, so it must finish at #1. Covers both the binary search and the
 * local repair verification phase.
 */
async function alwaysChoose(page: import("@playwright/test").Page, entryName: string) {
    const rankPanel = page.getByText(/Binary Rank|Local Repair/);
    for (let round = 0; round < 12; round++) {
        if (!(await rankPanel.isVisible().catch(() => false))) {
            return;
        }

        await page.getByRole("button", { name: entryName }).click();
        // Wait for either the next matchup or panel teardown before re-checking.
        await page.waitForTimeout(150);
    }

    await expect(rankPanel).toBeHidden();
}

test.describe("Ranking", () => {
    test("create a category and add the first entry", async ({ page, context }) => {
        await seedUsers([{ email: RANKER.email, name: RANKER.name }]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);

        await page.getByPlaceholder("New category").fill("Books");
        await page.getByPlaceholder("New category").press("Enter");
        await expect(page.getByRole("heading", { name: "Books" })).toBeVisible();

        await page.getByPlaceholder("New entry").fill("Dune");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText("#1 Dune")).toBeVisible();
    });

    test("new entry ranked via binary matchups lands at #1 when it always wins", async ({
        page,
        context
    }) => {
        await seedUsers([RANKER]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);
        await expect(page.getByText("#1 Alpha")).toBeVisible();

        await page.getByPlaceholder("New entry").fill("Zeta");
        await page.getByPlaceholder("New entry").press("Enter");

        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });
        await alwaysChoose(page, "Zeta");

        await expect(page.getByText("#1 Zeta")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#2 Alpha")).toBeVisible();
        await expect(page.getByText("#4 Gamma")).toBeVisible();
    });

    test("deleted entry can be restored via the undo toast", async ({ page, context }) => {
        await seedUsers([RANKER]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);
        await expect(page.getByText("#1 Alpha")).toBeVisible();

        await page.getByText("#1 Alpha").click({ button: "right" });
        await page.getByRole("button", { name: "Delete" }).click();

        await expect(page.getByText("Deleted Alpha.")).toBeVisible();
        await expect(page.getByText("#1 Alpha")).toBeHidden();

        await page.getByRole("button", { name: "Undo" }).click();
        await expect(page.getByText("Restored Alpha.")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("#1 Alpha")).toBeVisible();
    });

    test("entries can be renamed from the context menu", async ({ page, context }) => {
        await seedUsers([RANKER]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);
        await expect(page.getByText("#2 Beta")).toBeVisible();

        await page.getByText("#2 Beta").click({ button: "right" });
        await page.getByRole("button", { name: "Rename" }).click();
        await page.getByLabel("Rename Beta").fill("Beta Prime");
        await page.getByRole("button", { name: "Save" }).click();

        await expect(page.getByText("#2 Beta Prime")).toBeVisible({ timeout: 15_000 });
    });
});
