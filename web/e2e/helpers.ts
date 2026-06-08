import { expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { BASE_URL } from "./constants";

export const TEST_PASSWORD = "goldshelf-e2e-password";

/**
 * Navigates and waits for React hydration (marked on <html> by the root
 * route) so clicks are never swallowed by not-yet-attached handlers.
 */
export async function gotoApp(page: Page, path = "/") {
    await page.goto(path);
    await page.waitForSelector("html[data-hydrated]", { timeout: 15_000 });
}

export interface SeedEntry {
    name: string;
    imageKey?: string | null;
}

export interface SeedCategory {
    name: string;
    entries?: Array<SeedEntry | string>;
}

export interface SeedUser {
    email: string;
    password?: string;
    name: string;
    queueSettings?: {
        enabled?: boolean;
        delayDays?: number;
        promptForMissingImages?: boolean;
    };
    categories?: SeedCategory[];
}

export async function seedUsers(users: SeedUser[]) {
    const response = await fetch(`${BASE_URL}/api/test/seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            users: users.map((user) => ({ password: TEST_PASSWORD, ...user }))
        })
    });

    if (!response.ok) {
        throw new Error(`Seed failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { users: Array<{ id: string; email: string }> };
    return body.users;
}

/**
 * Signs in through the real better-auth endpoint using the browser context's
 * request client, so the session cookies land directly in the context.
 */
export async function signInViaApi(
    context: BrowserContext,
    email: string,
    password: string = TEST_PASSWORD
) {
    const response = await context.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
        data: { email, password },
        // better-auth rejects requests without an Origin header.
        headers: { origin: BASE_URL }
    });

    if (!response.ok()) {
        throw new Error(`Sign in failed for ${email}: ${response.status()} ${await response.text()}`);
    }
}

/**
 * Plays out an active ranking session by always picking `winnerName` in every
 * matchup, so it must finish at #1. Covers the binary search and local repair
 * phases, and returns once the session no longer offers that choice — which
 * also makes it safe for chained sessions (queue ranking) where the next
 * session's matchups use different entry names.
 *
 * Entry names in a test must not be substrings of each other (role-name
 * matching is substring-based).
 */
export async function winMatchups(page: Page, winnerName: string, maxRounds = 15) {
    const choice = page.getByRole("button", { name: winnerName });

    for (let round = 0; round < maxRounds; round += 1) {
        try {
            // Auto-waits while the previous round's submission is in flight.
            await choice.click({ timeout: 2_000 });
        } catch {
            // The button is gone, so the session must have completed; anything
            // else (still visible but stuck) should fail loudly.
            await expect(choice).toBeHidden();
            return;
        }
    }

    throw new Error(`Ranking session still offered ${winnerName} after ${maxRounds} matchups`);
}

/** Polls for an auth URL captured server-side in TEST_MODE (e.g. password reset links). */
export async function getAuthUrl(email: string, type: "reset-password") {
    for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch(
            `${BASE_URL}/api/test/auth-url?email=${encodeURIComponent(email)}&type=${type}`
        );
        if (response.ok) {
            const body = (await response.json()) as { url: string };
            return body.url;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`No ${type} URL captured for ${email}`);
}
