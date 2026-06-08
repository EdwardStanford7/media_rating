import { test, expect } from "./base";
import { gotoApp, seedUsers, signInViaApi } from "./helpers";

const USER = {
    email: "expiry@e2e.test",
    name: "Expiry",
    categories: [{ name: "Movies", entries: ["Alpha", "Beta"] }]
};

test.describe("Session expiry", () => {
    test("mutation after session loss redirects to the sign-in page", async ({
        page,
        context
    }) => {
        await seedUsers([USER]);
        await signInViaApi(context, USER.email);
        await gotoApp(page);
        await expect(page.getByText("#1 Alpha")).toBeVisible();

        // Simulate an expired/revoked session mid-use. The page still shows
        // the dashboard, but the next server action must fail with 401.
        await context.clearCookies();

        await page.getByPlaceholder("New category").fill("Books");
        await page.getByPlaceholder("New category").press("Enter");

        // The UnauthorizedError funnel should send the user to the sign-in
        // screen instead of surfacing an opaque error toast.
        await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
            timeout: 15_000
        });
    });
});
