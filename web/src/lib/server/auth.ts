import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "cloudflare:workers";

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function optionalEnv(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function isTruthyEnv(value: string | undefined) {
    return optionalEnv(value)?.toLowerCase() === "true";
}

async function userCount() {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM "user"').first<{ count: number }>();
    return Number(row?.count ?? 0);
}

async function isFirstUserSignup() {
    return (await userCount()) === 0;
}

export async function getEmailSignUpOptions() {
    const publicSignups = isTruthyEnv(env.ALLOW_PUBLIC_SIGNUPS);
    const inviteCode = optionalEnv(env.SIGNUP_INVITE_CODE);
    const firstUser = await isFirstUserSignup();

    return {
        enabled: publicSignups || firstUser || Boolean(inviteCode),
        inviteCodeRequired: !publicSignups && !firstUser && Boolean(inviteCode),
        minPasswordLength: MIN_PASSWORD_LENGTH
    };
}

const enforceSignUpPolicy = createAuthMiddleware(async (ctx) => {
    const isSignUpPath =
        ctx.path === "/sign-up/email" ||
        (ctx.request ? new URL(ctx.request.url).pathname.endsWith("/sign-up/email") : false);

    if (!isSignUpPath) {
        return;
    }

    if (isTruthyEnv(env.ALLOW_PUBLIC_SIGNUPS) || await isFirstUserSignup()) {
        return;
    }

    const inviteCode = optionalEnv(env.SIGNUP_INVITE_CODE);
    const submittedInviteCode = typeof ctx.body?.inviteCode === "string"
        ? ctx.body.inviteCode.trim()
        : undefined;

    if (inviteCode && submittedInviteCode === inviteCode) {
        return;
    }

    throw new APIError("FORBIDDEN", {
        message: inviteCode
            ? "A valid invite code is required to create an account."
            : "Sign up is disabled for this app."
    });
});

async function sendResetPasswordEmail({
    user,
    url
}: {
    user: { email: string; name?: string | null };
    url: string;
}) {
    const resendApiKey = optionalEnv(env.RESEND_API_KEY);
    const fromEmail = optionalEnv(env.PASSWORD_RESET_FROM_EMAIL);
    if (!resendApiKey || !fromEmail) {
        console.warn(`Password reset email is not configured. Reset link for ${user.email}: ${url}`);
        return;
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "authorization": `Bearer ${resendApiKey}`,
            "content-type": "application/json"
        },
        body: JSON.stringify({
            from: fromEmail,
            to: user.email,
            subject: "Reset your Media Rating password",
            text: [
                `Hi ${user.name || "there"},`,
                "",
                "Use this link to reset your Media Rating password:",
                url,
                "",
                "This link expires in 1 hour. If you did not request this, you can ignore this email."
            ].join("\n"),
            html: [
                `<p>Hi ${escapeHtml(user.name || "there")},</p>`,
                "<p>Use this link to reset your Media Rating password:</p>",
                `<p><a href="${escapeHtml(url)}">Reset password</a></p>`,
                "<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>"
            ].join("")
        })
    });

    if (!response.ok) {
        console.error("Password reset email failed", await response.text());
        throw new Error("Password reset email failed");
    }
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character] ?? character);
}

export const auth = betterAuth({
    appName: "Media Rating",
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
        enabled: true,
        minPasswordLength: MIN_PASSWORD_LENGTH,
        maxPasswordLength: MAX_PASSWORD_LENGTH,
        sendResetPassword: sendResetPasswordEmail,
        resetPasswordTokenExpiresIn: 60 * 60,
        revokeSessionsOnPasswordReset: true
    },
    rateLimit: {
        enabled: true,
        storage: "database",
        window: 60,
        max: 60,
        customRules: {
            "/sign-in/email": {
                window: 60,
                max: 12
            },
            "/sign-up/email": {
                window: 300,
                max: 3
            },
            "/request-password-reset": {
                window: 300,
                max: 3
            },
            "/reset-password": {
                window: 300,
                max: 5
            },
            "/change-password": {
                window: 300,
                max: 3
            },
            "/change-email": {
                window: 300,
                max: 3
            }
        }
    },
    advanced: {
        ipAddress: {
            ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"]
        },
        useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://")
    },
    hooks: {
        before: enforceSignUpPolicy
    },
    plugins: [tanstackStartCookies()]
});
