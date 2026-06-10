import { test, expect } from "./base";
import { gotoApp, openAccountMenu, seedUsers, signInViaApi, winMatchups } from "./helpers";

const RANKER = {
    email: "ranker@e2e.test",
    name: "Ranker",
    categories: [{ name: "Movies", entries: ["Alpha", "Beta", "Gamma"] }]
};

test.describe("Ranking", () => {
    test("mobile dashboard opens on compact app content and drawer tools work", async ({
        page,
        context
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seedUsers([{
            email: "mobile@e2e.test",
            name: "Mobile",
            queueSettings: {
                enabled: true,
                delayDays: 0,
                promptForMissingImages: false
            },
            categories: [
                { name: "Books", entries: ["Dune", "Hyperion", "Foundation"] },
                { name: "Movies", entries: ["Arrival"] }
            ]
        }]);
        await signInViaApi(context, "mobile@e2e.test");
        await gotoApp(page);

        const mobileHeader = page.getByTestId("mobile-dashboard-header");
        await expect(mobileHeader).toBeVisible();
        await expect(mobileHeader.getByRole("heading", { name: "Books" })).toBeVisible();
        await expect(page.getByText("New Category")).toBeHidden();

        const avatarBox = await page.getByRole("button", { name: "Account menu" }).boundingBox();
        const headerBox = await mobileHeader.boundingBox();
        expect(avatarBox?.x).toBeLessThan(24);
        expect(avatarBox?.y).toBeLessThan(80);
        expect(headerBox?.height).toBeLessThan(140);

        const firstCardWidth = await page.locator("[data-entry-id]").first().evaluate((element) => element.getBoundingClientRect().width);
        await mobileHeader.getByLabel("Search entries").fill("Dune");
        await expect(page.getByText("#1 Dune")).toBeVisible();
        const filteredCardWidth = await page.locator("[data-entry-id]").first().evaluate((element) => element.getBoundingClientRect().width);
        expect(Math.abs(filteredCardWidth - firstCardWidth)).toBeLessThanOrEqual(1);
        await mobileHeader.getByLabel("Search entries").fill("");

        await page.getByTestId("mobile-tools-trigger").click();
        let drawer = page.getByRole("dialog", { name: "Dashboard tools" });
        await expect(drawer.getByText("New Entry")).toBeVisible();
        await drawer.locator("[data-category-id]").filter({ hasText: "Movies" }).getByRole("button").first().click();
        await expect(drawer).toBeHidden();
        await expect(mobileHeader.getByRole("heading", { name: "Movies" })).toBeVisible();

        await page.getByTestId("mobile-tools-trigger").click();
        drawer = page.getByRole("dialog", { name: "Dashboard tools" });
        await drawer.getByPlaceholder("New entry").fill("Memento");
        await drawer.getByPlaceholder("New entry").press("Enter");
        await expect(drawer).toBeHidden({ timeout: 15_000 });

        await page.getByTestId("mobile-tools-trigger").click();
        drawer = page.getByRole("dialog", { name: "Dashboard tools" });
        await expect(drawer.getByText("1 queued")).toBeVisible();
        await expect(drawer.getByText("1 ready")).toBeVisible();
        await expect(drawer.getByText("Memento").first()).toBeVisible();
        await drawer.getByLabel("Actions for queued Memento").click();
        await expect(page.getByRole("menuitem", { name: "Rank Now" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Pick image" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Remove" })).toBeEnabled();
    });

    test("mobile tap action menus expose entry, category, queue, and ranking actions", async ({
        page,
        context
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seedUsers([{
            ...RANKER,
            queueSettings: {
                enabled: false,
                delayDays: 0,
                promptForMissingImages: false
            }
        }]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);

        await page.getByLabel("Actions for Alpha").click();
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Pick Image" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Rerank" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Change Category" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
        await page.keyboard.press("Escape");

        await page.getByTestId("mobile-tools-trigger").click();
        let drawer = page.getByRole("dialog", { name: "Dashboard tools" });
        await drawer.getByLabel("Actions for Movies").click();
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
        await page.keyboard.press("Escape");
        await drawer.getByRole("button", { name: "Close", exact: true }).click();

        await page.getByTestId("mobile-tools-trigger").click();
        drawer = page.getByRole("dialog", { name: "Dashboard tools" });
        await drawer.getByPlaceholder("New entry").fill("Zeta");
        await drawer.getByPlaceholder("New entry").press("Enter");
        await expect(drawer).toBeHidden({ timeout: 15_000 });
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });

        await page.getByLabel("Actions for Zeta").click();
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Pick Image" })).toBeEnabled();
        await page.getByRole("menuitem", { name: "Rename" }).click();
        await page.getByLabel("Rename Zeta").fill("Zeta Prime");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByLabel("Actions for Zeta Prime")).toBeVisible({ timeout: 15_000 });
    });

    test("dashboard topbar stays flush while the entry list scrolls", async ({
        page,
        context
    }) => {
        await seedUsers([{
            email: "layout@e2e.test",
            name: "Layout",
            categories: [{
                name: "Long List",
                entries: Array.from({ length: 30 }, (_, index) => `Item ${index + 1}`)
            }]
        }]);
        await signInViaApi(context, "layout@e2e.test");
        await gotoApp(page);
        await expect(page.getByText("#1 Item 1")).toBeVisible();

        const scroller = page.getByTestId("dashboard-scroll-region");
        await scroller.evaluate((element) => element.scrollTo({ top: 520 }));
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

        const metrics = await page.evaluate(() => {
            const topbarElement = document.querySelector("[data-testid='dashboard-topbar']");
            const scrollRegionElement = document.querySelector("[data-testid='dashboard-scroll-region']");
            const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-entry-id]"));
            const topbar = topbarElement?.getBoundingClientRect();
            const scrollRegion = scrollRegionElement?.getBoundingClientRect();
            if (!topbar || !scrollRegion || !scrollRegionElement || cards.length === 0) {
                throw new Error("Dashboard layout markers not found");
            }

            const firstCard = cards[0].getBoundingClientRect();
            const firstRowCards = cards
                .map((card) => card.getBoundingClientRect())
                .filter((card) => Math.abs(card.top - firstCard.top) < 2);
            const style = getComputedStyle(scrollRegionElement);
            const contentRight = scrollRegion.right - Number.parseFloat(style.paddingRight);

            return {
                firstRowCardWidth: firstCard.width,
                firstRowRightGap: contentRight - Math.max(...firstRowCards.map((card) => card.right)),
                scrollRegionTop: scrollRegion.top,
                topbarBottom: topbar.bottom,
                topbarTop: topbar.top
            };
        });

        expect(Math.abs(metrics.topbarTop)).toBeLessThanOrEqual(1);
        expect(metrics.scrollRegionTop).toBeGreaterThanOrEqual(metrics.topbarBottom - 1);
        expect(metrics.firstRowCardWidth).toBeGreaterThan(200);
        expect(metrics.firstRowRightGap).toBeLessThanOrEqual(12);
    });

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

    test("profile navigation during ranking requires confirm cancel", async ({
        page,
        context
    }) => {
        await seedUsers([RANKER]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);

        await page.getByPlaceholder("New entry").fill("Zeta");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });

        await openAccountMenu(page);
        await page.getByRole("menuitem", { name: "Profile" }).click();
        await expect(page.getByRole("heading", { name: "Cancel active ranking?" })).toBeVisible();
        await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible();
        await expect(page).toHaveURL("/");

        await openAccountMenu(page);
        await page.getByRole("menuitem", { name: "Profile" }).click();
        await page.getByRole("button", { name: "Cancel and Open Profile" }).click();
        await expect(page).toHaveURL("/profile");
        await expect(page.getByRole("heading", { name: "Ranker" })).toBeVisible();
    });

    test("entry metadata actions stay available while ranking but order actions stay locked", async ({
        page,
        context
    }) => {
        await seedUsers([RANKER]);
        await signInViaApi(context, RANKER.email);
        await gotoApp(page);

        await page.getByPlaceholder("New entry").fill("Zeta");
        await page.getByPlaceholder("New entry").press("Enter");
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible({ timeout: 15_000 });

        await page.getByRole("button", { name: "Zeta" }).click({ button: "right" });
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Pick Image" })).toBeEnabled();
        await page.getByRole("menuitem", { name: "Rename" }).click();
        await page.getByLabel("Rename Zeta").fill("Zeta Prime");
        await page.getByRole("button", { name: "Save", exact: true }).click();

        await expect(page.getByRole("button", { name: "Zeta Prime" })).toBeVisible({ timeout: 15_000 });
        await page.getByText("#1 Alpha").click({ button: "right" });
        await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Pick Image" })).toBeEnabled();
        await expect(page.getByRole("menuitem", { name: "Rerank" })).toHaveAttribute("aria-disabled", "true");
        await expect(page.getByRole("menuitem", { name: "Change Category" })).toHaveAttribute("aria-disabled", "true");
        await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");

        await page.getByRole("menuitem", { name: "Rename" }).click();
        await page.getByLabel("Rename Alpha").fill("Alpha Prime");
        await page.getByRole("button", { name: "Save", exact: true }).click();

        await expect(page.getByText("#1 Alpha Prime")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/Binary Rank|Local Repair/)).toBeVisible();
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
