import { env } from "cloudflare:workers";

export type CapturedAuthUrlType = "reset-password";

export function isTestMode() {
    return env.TEST_MODE === "true";
}

export function testModeGate() {
    if (!isTestMode()) {
        return Response.json({ message: "Not found" }, { status: 404 });
    }

    return null;
}

const capturedAuthUrls = new Map<string, string>();

function authUrlKey(type: CapturedAuthUrlType, email: string) {
    return `${type}:${email.trim().toLowerCase()}`;
}

export function captureAuthUrl(type: CapturedAuthUrlType, email: string, url: string) {
    capturedAuthUrls.set(authUrlKey(type, email), url);
}

export function takeAuthUrl(type: CapturedAuthUrlType, email: string) {
    const key = authUrlKey(type, email);
    const url = capturedAuthUrls.get(key) ?? null;
    if (url) {
        capturedAuthUrls.delete(key);
    }

    return url;
}
