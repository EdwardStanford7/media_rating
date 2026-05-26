const POSTER_WIDTH = 380;
const POSTER_HEIGHT = 475;
const SEARCH_RESULT_COUNT = 12;

interface DuckDuckGoImageResult {
    image?: string;
    thumbnail?: string;
    width?: number;
    height?: number;
}

export interface ImageSearchCandidate {
    id: string;
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
}

export async function searchImageCandidates(query: string): Promise<ImageSearchCandidate[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        throw new Error("Search query is required");
    }

    const htmlUrl = new URL("https://duckduckgo.com/");
    htmlUrl.searchParams.set("q", cleanQuery);
    htmlUrl.searchParams.set("iax", "images");
    htmlUrl.searchParams.set("ia", "images");

    const html = await fetchText(htmlUrl, undefined);
    const vqd = extractVqd(html);
    if (!vqd) {
        throw new Error("Could not start image search");
    }

    const jsonUrl = new URL("https://duckduckgo.com/i.js");
    jsonUrl.searchParams.set("q", cleanQuery);
    jsonUrl.searchParams.set("vqd", vqd);
    jsonUrl.searchParams.set("o", "json");

    const json = await fetchText(jsonUrl, "https://duckduckgo.com/");
    const payload = JSON.parse(json) as { results?: DuckDuckGoImageResult[] };
    const results = Array.isArray(payload.results) ? payload.results : [];
    const targetRatio = POSTER_WIDTH / POSTER_HEIGHT;

    return results
        .filter((result) => result.image && result.width && result.height)
        .map((result) => ({
            ratioDiff: Math.abs((result.width ?? 0) / (result.height ?? 1) - targetRatio),
            result
        }))
        .sort((left, right) => left.ratioDiff - right.ratioDiff)
        .slice(0, SEARCH_RESULT_COUNT)
        .map(({ result }) => {
            const imageId = encodeImageUrl(result.image ?? "");
            const thumbnailId = encodeImageUrl(result.thumbnail || result.image || "");
            return {
                id: imageId,
                imageUrl: `/api/image-proxy?u=${encodeURIComponent(imageId)}`,
                thumbnailUrl: `/api/image-proxy?u=${encodeURIComponent(thumbnailId)}`,
                width: result.width ?? 0,
                height: result.height ?? 0
            };
        });
}

export function encodeImageUrl(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
}

export function decodeImageUrl(value: string) {
    const base64 = value
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function assertSafeImageUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Unsupported image URL");
    }

    if (isBlockedHost(url.hostname)) {
        throw new Error("Unsupported image host");
    }

    return url;
}

function extractVqd(html: string) {
    for (const pattern of ['vqd="', "vqd='"]) {
        const start = html.indexOf(pattern);
        if (start === -1) {
            continue;
        }

        const valueStart = start + pattern.length;
        const rest = html.slice(valueStart);
        const end = rest.search(/["']/);
        if (end !== -1) {
            return rest.slice(0, end);
        }
    }

    return null;
}

async function fetchText(url: URL, referer: string | undefined) {
    const response = await fetch(url, {
        headers: {
            "accept": "text/html,application/json",
            "referer": referer ?? "https://duckduckgo.com/",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        }
    });

    if (!response.ok) {
        throw new Error(`Image search failed with ${response.status}`);
    }

    return response.text();
}

function isBlockedHost(hostname: string) {
    const host = hostname.toLowerCase();
    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local")
    ) {
        return true;
    }

    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
        return true;
    }

    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!ipv4) {
        return false;
    }

    const [first, second] = ipv4.slice(1).map(Number);
    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
    );
}
