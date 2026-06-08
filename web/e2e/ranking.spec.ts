import { test, expect } from "./base";
import { gotoApp, seedUsers, signInViaApi, winMatchups } from "./helpers";

const RANKER = {
    email: "ranker@e2e.test",
    name: "Ranker",
    categories: [{ name: "Movies", entries: ["Alpha", "Beta", "Gamma"] }]
};

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
        await winMatchups(page, "Zeta");

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
        await page.getByRole("menuitem", { name: "Delete" }).click();

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
        await page.getByRole("menuitem", { name: "Rename" }).click();
        await page.getByLabel("Rename Beta").fill("Beta Prime");
        await page.getByRole("button", { name: "Save" }).click();

        await expect(page.getByText("#2 Beta Prime")).toBeVisible({ timeout: 15_000 });
    });
});
