declare namespace Cloudflare {
    interface Env {
        DB: D1Database;
        IMAGES: R2Bucket;
        BETTER_AUTH_URL: string;
        BETTER_AUTH_SECRET: string;
        RESEND_API_KEY?: string;
        PASSWORD_RESET_FROM_EMAIL?: string;
    }
}
