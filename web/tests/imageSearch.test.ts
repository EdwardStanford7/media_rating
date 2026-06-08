import { describe, expect, it } from "vitest";
import { assertSafeImageUrl } from "../src/server/lib/imageSearch";

describe("image proxy URL safety", () => {
    it("allows public http and https image URLs", () => {
        expect(assertSafeImageUrl("https://images.example.com/poster.jpg").hostname)
            .toBe("images.example.com");
        expect(assertSafeImageUrl("http://cdn.example.com/poster.jpg").hostname)
            .toBe("cdn.example.com");
        expect(assertSafeImageUrl("https://fda.gov/poster.jpg").hostname)
            .toBe("fda.gov");
        expect(assertSafeImageUrl("https://fc.example.com/poster.jpg").hostname)
            .toBe("fc.example.com");
    });

    it("blocks local and private direct hosts", () => {
        const blockedUrls = [
            "http://localhost/image.jpg",
            "http://127.0.0.1/image.jpg",
            "http://10.0.0.5/image.jpg",
            "http://172.16.0.5/image.jpg",
            "http://192.168.1.10/image.jpg",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/image.jpg",
            "http://[fd00::1]/image.jpg",
            "http://[fe80::1]/image.jpg",
            "http://[::ffff:127.0.0.1]/image.jpg"
        ];

        for (const url of blockedUrls) {
            expect(() => assertSafeImageUrl(url), url).toThrow("Unsupported image host");
        }
    });

    it("rejects non-http protocols", () => {
        expect(() => assertSafeImageUrl("file:///etc/passwd")).toThrow("Unsupported image URL");
    });
});
