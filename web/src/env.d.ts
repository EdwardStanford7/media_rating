declare namespace Cloudflare {
    interface Env {
        DB: D1Database;
        IMAGES: R2Bucket;
        BETTER_AUTH_URL: string;
        BETTER_AUTH_SECRET: string;
        SIGNUP_INVITE_CODE?: string;
        ALLOW_PUBLIC_SIGNUPS?: string;
    }
}
