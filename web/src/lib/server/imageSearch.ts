const POSTER_WIDTH = 380;
const POSTER_HEIGHT = 475;
const SEARCH_RESULT_COUNT = 18;
const SEARCH_CACHE_LIMIT = 50;

const searchCache = new Map<string, ImageSearchCandidate[]>();

interface DuckDuckGoImageResult {
    image?: string;
    thumbnail?: string;
    width?: number;
    height?: number;
}

interface CandidateSource {
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
}

interface WikipediaPage {
    thumbnail?: {
        source?: string;
        width?: number;
        height?: number;
    };
}

interface CommonsPage {
    imageinfo?: Array<{
        thumburl?: string;
        url?: string;
        thumbwidth?: number;
        thumbheight?: number;
        width?: number;
        height?: number;
    }>;
}

export interface ImageSearchCandidate {
    id: string;
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
}

interface TextResponse {
    text: string;
    cookie: string | null;
}

export async function searchImageCandidates(query: string): Promise<ImageSearchCandidate[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        throw new Error("Search query is required");
    }

    const cacheKey = cleanQuery.toLowerCase();
    const cachedCandidates = searchCache.get(cacheKey);
    try {
        const candidates = await fetchImageCandidates(cleanQuery);
        cacheImageCandidates(cacheKey, candidates);
        return candidates;
    } catch (error) {
        if (cachedCandidates) {
            return cachedCandidates;
        }

        try {
            const fallbackCandidates = await fetchFallbackImageCandidates(cleanQuery);
            cacheImageCandidates(cacheKey, fallbackCandidates);
            return fallbackCandidates;
        } catch {
            throw error;
        }
    }
}

async function fetchImageCandidates(cleanQuery: string): Promise<ImageSearchCandidate[]> {
    const htmlUrl = new URL("https://duckduckgo.com/");
    htmlUrl.searchParams.set("q", cleanQuery);
    htmlUrl.searchParams.set("iax", "images");
    htmlUrl.searchParams.set("ia", "images");

    const htmlResponse = await fetchText(htmlUrl, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        mode: "document",
        referer: "https://duckduckgo.com/"
    });
    const vqd = extractVqd(htmlResponse.text);
    if (!vqd) {
        throw new Error("Could not start image search");
    }

    const jsonUrl = new URL("https://duckduckgo.com/i.js");
    jsonUrl.searchParams.set("q", cleanQuery);
    jsonUrl.searchParams.set("vqd", vqd);
    jsonUrl.searchParams.set("o", "json");
    jsonUrl.searchParams.set("l", "us-en");
    jsonUrl.searchParams.set("p", "1");
    jsonUrl.searchParams.set("f", ",,,");

    const jsonResponse = await fetchText(jsonUrl, {
        accept: "application/json, text/javascript, */*; q=0.01",
        cookie: htmlResponse.cookie,
        mode: "cors",
        referer: htmlUrl.toString(),
        requestedWith: "XMLHttpRequest"
    });
    const payload = JSON.parse(jsonResponse.text) as { results?: DuckDuckGoImageResult[] };
    const results = Array.isArray(payload.results) ? payload.results : [];

    return sourcesToCandidates(
        results
        .filter((result) => result.image && result.width && result.height)
        .map((result) => ({
            imageUrl: result.image ?? "",
            thumbnailUrl: result.thumbnail || result.image || "",
            width: result.width ?? 0,
            height: result.height ?? 0
        }))
    );
}

async function fetchFallbackImageCandidates(cleanQuery: string): Promise<ImageSearchCandidate[]> {
    const sources = [
        ...await fetchWikipediaPageImages(cleanQuery),
        ...await fetchCommonsImages(cleanQuery)
    ];
    const candidates = sourcesToCandidates(sources);
    if (candidates.length === 0) {
        throw new Error("No fallback images found");
    }

    return candidates;
}

async function fetchWikipediaPageImages(cleanQuery: string): Promise<CandidateSource[]> {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", cleanQuery);
    url.searchParams.set("gsrlimit", "12");
    url.searchParams.set("prop", "pageimages");
    url.searchParams.set("piprop", "thumbnail");
    url.searchParams.set("pithumbsize", "700");
    url.searchParams.set("origin", "*");

    const response = await fetchJson<{ query?: { pages?: Record<string, WikipediaPage> } }>(url);
    return Object.values(response.query?.pages ?? {})
        .map((page) => page.thumbnail)
        .filter((thumbnail): thumbnail is Required<WikipediaPage>["thumbnail"] =>
            Boolean(thumbnail?.source && thumbnail.width && thumbnail.height)
        )
        .map((thumbnail) => ({
            imageUrl: thumbnail.source ?? "",
            thumbnailUrl: thumbnail.source ?? "",
            width: thumbnail.width ?? 0,
            height: thumbnail.height ?? 0
        }));
}

async function fetchCommonsImages(cleanQuery: string): Promise<CandidateSource[]> {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", cleanQuery);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", "18");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|size");
    url.searchParams.set("iiurlwidth", "700");
    url.searchParams.set("origin", "*");

    const response = await fetchJson<{ query?: { pages?: Record<string, CommonsPage> } }>(url);
    return Object.values(response.query?.pages ?? {})
        .flatMap((page) => page.imageinfo ?? [])
        .filter((image) => (image.thumburl || image.url) && (image.thumbwidth || image.width) && (image.thumbheight || image.height))
        .map((image) => ({
            imageUrl: image.url ?? image.thumburl ?? "",
            thumbnailUrl: image.thumburl ?? image.url ?? "",
            width: image.width ?? image.thumbwidth ?? 0,
            height: image.height ?? image.thumbheight ?? 0
        }));
}

function sourcesToCandidates(sources: CandidateSource[]): ImageSearchCandidate[] {
    const targetRatio = POSTER_WIDTH / POSTER_HEIGHT;
    const seen = new Set<string>();

    return sources
        .filter((source) => source.imageUrl && source.width > 0 && source.height > 0)
        .filter((source) => {
            if (seen.has(source.imageUrl)) {
                return false;
            }
            seen.add(source.imageUrl);
            return true;
        })
        .map((source) => ({
            ratioDiff: Math.abs(source.width / source.height - targetRatio),
            source
        }))
        .sort((left, right) => left.ratioDiff - right.ratioDiff)
        .slice(0, SEARCH_RESULT_COUNT)
        .map(({ source }) => {
            const imageId = encodeImageUrl(source.imageUrl);
            const thumbnailId = encodeImageUrl(source.thumbnailUrl || source.imageUrl);
            return {
                id: imageId,
                imageUrl: `/api/image-proxy?u=${encodeURIComponent(imageId)}`,
                thumbnailUrl: `/api/image-proxy?u=${encodeURIComponent(thumbnailId)}`,
                width: source.width,
                height: source.height
            };
        });
}

function cacheImageCandidates(cacheKey: string, candidates: ImageSearchCandidate[]) {
    if (searchCache.has(cacheKey)) {
        searchCache.delete(cacheKey);
    }

    searchCache.set(cacheKey, candidates);

    while (searchCache.size > SEARCH_CACHE_LIMIT) {
        const oldestKey = searchCache.keys().next().value;
        if (!oldestKey) {
            return;
        }
        searchCache.delete(oldestKey);
    }
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

async function fetchText(
    url: URL,
    options: {
        accept: string;
        cookie?: string | null;
        mode: "document" | "cors";
        referer: string;
        requestedWith?: string;
    }
): Promise<TextResponse> {
    const headers = new Headers({
        "accept": options.accept,
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "referer": options.referer,
        "sec-fetch-dest": options.mode === "document" ? "document" : "empty",
        "sec-fetch-mode": options.mode === "document" ? "navigate" : "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
    if (options.cookie) {
        headers.set("cookie", options.cookie);
    }
    if (options.requestedWith) {
        headers.set("x-requested-with", options.requestedWith);
    }

    const response = await fetch(url, {
        headers
    });

    if (!response.ok) {
        throw new Error(`Image search failed with ${response.status}`);
    }

    return {
        text: await response.text(),
        cookie: response.headers.getSetCookie?.().map((cookie) => cookie.split(";")[0]).join("; ") ||
            response.headers.get("set-cookie")?.split(",").map((cookie) => cookie.split(";")[0]).join("; ") ||
            null
    };
}

async function fetchJson<T>(url: URL): Promise<T> {
    const response = await fetch(url, {
        headers: {
            "accept": "application/json",
            "user-agent": "MediaRating/1.0 (personal media ranking app)"
        }
    });

    if (!response.ok) {
        throw new Error(`Fallback image search failed with ${response.status}`);
    }

    return response.json() as Promise<T>;
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
