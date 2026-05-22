import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "cloudflare:workers";

export const auth = betterAuth({
  appName: "Media Rating",
  database: env.DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? ""
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID ?? "",
      clientSecret: env.APPLE_CLIENT_SECRET ?? ""
    }
  },
  plugins: [tanstackStartCookies()]
});
