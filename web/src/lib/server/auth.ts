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
        max: 5
      },
      "/sign-up/email": {
        window: 300,
        max: 3
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
