declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    BETTER_AUTH_URL: string;
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    APPLE_CLIENT_ID?: string;
    APPLE_CLIENT_SECRET?: string;
  }
}
