import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { gotoApp, seedUsers, signInViaApi } from "./helpers";

const ALICE = {
    email: "alice@e2e.test",
    name: "Alice Park",
    categories: [
        { name: "Movies", entries: ["Arrival", "Dune"] },
        { name: "Books", entries: ["Hyperion"] }
    ]
};

const BOB = {
    email: "bob@e2e.test",
    name: "Bob Stone",
    categories: [] as Array<{ name: string; entries: string[] }>
};

/** Reads the @handle shown in the profile settings header. */
async function readOwnSlug(page: Page) {
    const handleText = await page.getByText(/^@[a-z0-9-]+$/).first().textContent();
    expect(handleText, "profile handle should be visible on /profile").toBeTruthy();
    return handleText!.slice(1);
}

test.describe("Profiles", () => {
    test("publish profile, share rankings, full follow round-trip, revoke access", async ({
        page: alicePage,
        context: aliceContext,
        browser
    }) => {
        test.setTimeout(120_000);
        await seedUsers([ALICE, BOB]);
        await signInViaApi(aliceContext, ALICE.email);

        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        await signInViaApi(bobContext, BOB.email);

        const anonContext = await browser.newContext();
        const anonPage = await anonContext.newPage();

        // --- Alice publishes her profile and her Movies ranking. ---
        await gotoApp(alicePage, "/profile");
        const aliceSlug = await readOwnSlug(alicePage);
        await expect(alicePage.getByRole("button", { name: "Copy Link" })).toBeDisabled();

        await alicePage.getByLabel("Public profile").check();
        await alicePage.getByRole("button", { name: "Save Profile" }).click();
        await expect(alicePage.getByText("Profile saved.")).toBeVisible();
        await expect(alicePage.getByRole("button", { name: "Copy Link" })).toBeEnabled();

        // The visibility checkbox is controlled and only flips after the save
        // round-trip, so click + poll instead of check() (which verifies
        // state synchronously).
        await alicePage.getByRole("checkbox", { name: /Movies/ }).click();
        await expect(alicePage.getByText("Ranking visibility saved.").first()).toBeVisible();
        await expect(alicePage.getByRole("checkbox", { name: /Movies/ })).toBeChecked();

        // --- Her own public page shows only the public category. ---
        await alicePage.getByRole("link", { name: "Public Profile" }).click();
        await expect(alicePage).toHaveURL(`/u/${aliceSlug}`);
        await expect(alicePage.getByRole("heading", { name: "Alice Park" })).toBeVisible();
        await expect(alicePage.getByRole("link", { name: "Edit Profile" })).toBeVisible();
        await expect(alicePage.getByText("Arrival")).toBeVisible();
        await expect(alicePage.getByText("Dune")).toBeVisible();
        await expect(alicePage.getByText("Hyperion")).toBeHidden();

        // --- Signed-out visitors see the public page; private/unknown slugs 404. ---
        await gotoApp(anonPage, `/u/${aliceSlug}`);
        await expect(anonPage.getByRole("heading", { name: "Alice Park" })).toBeVisible();
        await expect(anonPage.getByText("Arrival")).toBeVisible();
        await expect(anonPage.getByText("Hyperion")).toBeHidden();
        // Both the topbar and the header action link to sign-in.
        await expect(anonPage.getByRole("link", { name: "Sign In" }).first()).toBeVisible();

        await gotoApp(anonPage, "/u/does-not-exist");
        await expect(anonPage.getByRole("heading", { name: "Profile Not Found" })).toBeVisible();

        // Bob's profile is still private.
        await gotoApp(bobPage, "/profile");
        const bobSlug = await readOwnSlug(bobPage);
        await gotoApp(anonPage, `/u/${bobSlug}`);
        await expect(anonPage.getByRole("heading", { name: "Profile Not Found" })).toBeVisible();

        // --- Bob follows Alice's public profile directly. ---
        await gotoApp(bobPage, `/u/${aliceSlug}`);
        await bobPage.getByRole("button", { name: "Follow", exact: true }).click();
        await expect(bobPage.getByText("Profile followed.")).toBeVisible();
        await expect(bobPage.getByRole("button", { name: "Following" })).toBeVisible();

        // --- Alice requests to follow Bob's private profile by exact handle. ---
        await gotoApp(alicePage, "/profile");
        await alicePage.getByLabel("Profile handle, name, or profile link").fill(bobSlug);
        // Bob's follower row also offers a follow-back "Follow" button; the
        // Find Profiles submit comes first in the page.
        await alicePage.getByRole("button", { name: "Follow", exact: true }).first().click();
        await expect(alicePage.getByText("Follow request sent.")).toBeVisible();
        // Bob can appear in both Followers and Sent Requests.
        await expect(alicePage.getByText("Bob Stone").first()).toBeVisible();
        await expect(alicePage.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();

        // --- Bob approves; the relationship becomes mutual on both sides. ---
        await gotoApp(bobPage, "/profile");
        await expect(bobPage.getByText("Alice Park").first()).toBeVisible();
        await bobPage.getByRole("button", { name: "Accept", exact: true }).click();
        await expect(bobPage.getByText("Follow request accepted.")).toBeVisible();
        await expect(bobPage.getByText("Mutual").first()).toBeVisible();

        await gotoApp(alicePage, "/profile");
        await expect(alicePage.getByText("Bob Stone").first()).toBeVisible();
        await expect(alicePage.getByText("Mutual").first()).toBeVisible();

        // --- Hiding the category removes it from the public page. ---
        await alicePage.getByRole("checkbox", { name: /Movies/ }).click();
        await expect(alicePage.getByText("Ranking visibility saved.").first()).toBeVisible();
        await expect(alicePage.getByRole("checkbox", { name: /Movies/ })).not.toBeChecked();

        await gotoApp(anonPage, `/u/${aliceSlug}`);
        await expect(anonPage.getByRole("heading", { name: "Alice Park" })).toBeVisible();
        await expect(anonPage.getByText("No Public Rankings")).toBeVisible();
        await expect(anonPage.getByText("Arrival")).toBeHidden();

        // --- Going private hides the page from visitors but not followers. ---
        await alicePage.getByLabel("Public profile").uncheck();
        await alicePage.getByRole("button", { name: "Save Profile" }).click();
        await expect(alicePage.getByText("Profile saved.")).toBeVisible();

        await gotoApp(anonPage, `/u/${aliceSlug}`);
        await expect(anonPage.getByRole("heading", { name: "Profile Not Found" })).toBeVisible();

        await gotoApp(bobPage, `/u/${aliceSlug}`);
        await expect(bobPage.getByRole("heading", { name: "Alice Park" })).toBeVisible();

        // --- Unfollowing revokes Bob's access to the private profile. ---
        await bobPage.getByRole("button", { name: "Mutual" }).click();
        await expect(bobPage.getByText("Profile unfollowed.")).toBeVisible();

        await gotoApp(bobPage, `/u/${aliceSlug}`);
        await expect(bobPage.getByRole("heading", { name: "Profile Not Found" })).toBeVisible();

        await bobContext.close();
        await anonContext.close();
    });
});
