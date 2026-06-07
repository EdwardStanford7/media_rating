import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { errorMessage } from "@/lib/format";
import {
    imageCandidateToPosterBlob,
    imageElementToPosterBlob,
    imageUrlToPosterBlob,
    uploadImageForTarget,
    withCacheBust,
    type ImagePickerTarget,
    type ImageSearchCandidate
} from "@/lib/posterImage";
import { markImageUnavailable } from "@/server/functions/actions";

const IMAGE_SEARCH_TIMEOUT_MS = 15_000;

export function ImagePickerModal({
    target,
    onClose,
    onSaved
}: {
    target: ImagePickerTarget;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const defaultQuery = `${target.item.name} (${target.category.name})`;
    const [query, setQuery] = useState(defaultQuery);
    const [candidates, setCandidates] = useState<ImageSearchCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const candidatesRef = useRef<ImageSearchCandidate[]>([]);
    const candidatesByQueryRef = useRef<Map<string, ImageSearchCandidate[]>>(new Map());
    const thumbnailPosterBlobsRef = useRef<Map<string, Blob>>(new Map());
    const displayedQueryRef = useRef<string | null>(null);
    const searchRequestIdRef = useRef(0);
    const activeSearchControllerRef = useRef<AbortController | null>(null);
    useEscapeKey(true, onClose);

    function interruptSearch() {
        searchRequestIdRef.current += 1;
        activeSearchControllerRef.current?.abort();
        activeSearchControllerRef.current = null;
        setLoading(false);
    }

    const search = useCallback(async (searchQuery: string) => {
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        const submittedQuery = searchQuery.trim();
        if (!submittedQuery) {
            setLoading(false);
            setError("Search query is required.");
            return;
        }

        const cachedCandidates = candidatesByQueryRef.current.get(submittedQuery.toLowerCase());
        if (cachedCandidates && cachedCandidates.length > 0) {
            candidatesRef.current = cachedCandidates;
            thumbnailPosterBlobsRef.current.clear();
            displayedQueryRef.current = submittedQuery;
            setCandidates(cachedCandidates);
            setError(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        const cacheBust = crypto.randomUUID();
        activeSearchControllerRef.current?.abort();
        const controller = new AbortController();
        activeSearchControllerRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_SEARCH_TIMEOUT_MS);

        try {
            const url = new URL("/api/image-search", window.location.origin);
            url.searchParams.set(target.kind === "entry" ? "entryId" : "queuedEntryId", target.item.id);
            url.searchParams.set("query", submittedQuery);
            url.searchParams.set("refresh", cacheBust);
            const response = await fetch(url, {
                cache: "no-store",
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({})) as {
                candidates?: ImageSearchCandidate[];
                message?: string;
            };

            if (!response.ok) {
                throw new Error(body.message ?? "Image search failed");
            }

            if (requestId !== searchRequestIdRef.current) {
                return;
            }

            const candidates = Array.isArray(body.candidates) ? body.candidates : [];
            const nextCandidates = candidates.map((candidate) => ({
                ...candidate,
                imageUrl: withCacheBust(candidate.imageUrl, cacheBust),
                thumbnailUrl: withCacheBust(candidate.thumbnailUrl, cacheBust)
            }));
            if (nextCandidates.length === 0) {
                throw new Error("No image candidates found");
            }

            candidatesRef.current = nextCandidates;
            candidatesByQueryRef.current.set(submittedQuery.toLowerCase(), nextCandidates);
            thumbnailPosterBlobsRef.current.clear();
            displayedQueryRef.current = submittedQuery;
            setCandidates(nextCandidates);
        } catch (searchError) {
            if (requestId !== searchRequestIdRef.current) {
                return;
            }

            if (candidatesRef.current.length > 0) {
                setCandidates(candidatesRef.current);
                const previousQuery = displayedQueryRef.current
                    ? ` for "${displayedQueryRef.current}"`
                    : "";
                setError(`${errorMessage(searchError)}. Showing previous results${previousQuery}.`);
            } else {
                setCandidates([]);
                setError(errorMessage(searchError));
            }
        } finally {
            window.clearTimeout(timeoutId);
            if (requestId === searchRequestIdRef.current) {
                if (activeSearchControllerRef.current === controller) {
                    activeSearchControllerRef.current = null;
                }
                setLoading(false);
            }
        }
    }, [target.kind, target.item.id]);

    useEffect(() => {
        setQuery(defaultQuery);
        candidatesRef.current = [];
        candidatesByQueryRef.current.clear();
        thumbnailPosterBlobsRef.current.clear();
        displayedQueryRef.current = null;
        setCandidates([]);
        void search(defaultQuery);
    }, [defaultQuery, search]);

    useEffect(() => () => {
        searchRequestIdRef.current += 1;
        activeSearchControllerRef.current?.abort();
    }, []);

    async function selectCandidate(
        candidate: ImageSearchCandidate,
        renderedThumbnail: HTMLImageElement | null
    ) {
        setSavingCandidateId(candidate.id);
        setError(null);

        try {
            const blob = await imageCandidateToPosterBlob(
                candidate,
                renderedThumbnail,
                thumbnailPosterBlobsRef.current.get(candidate.id) ?? null
            );
            await uploadImageForTarget(target, blob);
            await onSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    function cacheRenderedThumbnail(candidate: ImageSearchCandidate, image: HTMLImageElement) {
        void imageElementToPosterBlob(image)
            .then((blob) => {
                thumbnailPosterBlobsRef.current.set(candidate.id, blob);
            })
            .catch(() => {
                thumbnailPosterBlobsRef.current.delete(candidate.id);
            });
    }

    async function uploadLocalFile(file: File) {
        interruptSearch();
        setSavingCandidateId("local");
        setError(null);

        try {
            const objectUrl = URL.createObjectURL(file);
            try {
                const blob = await imageUrlToPosterBlob(objectUrl);
                await uploadImageForTarget(target, blob);
                await onSaved();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    async function saveNoImage() {
        interruptSearch();
        setSavingCandidateId("none");
        setError(null);

        try {
            await markImageUnavailable({
                data: {
                    targetKind: target.kind,
                    targetId: target.item.id
                }
            });
            await onSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    return (
        <div
            className="modal-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section className="image-picker-modal">
                <div className="toolbar">
                    <div>
                        <h2>Pick Image</h2>
                        <p className="muted">{target.item.name} - {target.category.name}</p>
                    </div>
                    <button type="button" onClick={onClose}>Close</button>
                </div>

                <form
                    className="form-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void search(query);
                    }}
                >
                    <input
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            if (error) {
                                setError(null);
                            }
                        }}
                        placeholder="Search"
                    />
                    <button disabled={loading || Boolean(savingCandidateId)} type="submit">Search</button>
                    <button
                        disabled={loading || Boolean(savingCandidateId)}
                        type="button"
                        onClick={() => {
                            setQuery(defaultQuery);
                            void search(defaultQuery);
                        }}
                    >
                        Default
                    </button>
                </form>

                <div className="image-picker-actions">
                    <label className="file-button">
                        <span>Upload File</span>
                        <input
                            accept="image/*"
                            disabled={Boolean(savingCandidateId)}
                            type="file"
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) {
                                    void uploadLocalFile(file);
                                }
                            }}
                        />
                    </label>
                    <button
                        disabled={Boolean(savingCandidateId)}
                        type="button"
                        onClick={() => void saveNoImage()}
                    >
                        {savingCandidateId === "none" ? "Saving..." : "Use No Image"}
                    </button>
                </div>

                {error ? <div className="status">{error}</div> : null}
                {loading ? <div className="status">Searching for images...</div> : null}

                <div className="image-picker-grid">
                    {candidates.map((candidate) => (
                        <button
                            className="image-candidate"
                            disabled={Boolean(savingCandidateId)}
                            key={candidate.id}
                            type="button"
                            onClick={(event) => {
                                const renderedThumbnail = event.currentTarget.querySelector("img");
                                void selectCandidate(candidate, renderedThumbnail);
                            }}
                        >
                            <img
                                alt=""
                                src={candidate.thumbnailUrl}
                                loading="lazy"
                                decoding="async"
                                onLoad={(event) => cacheRenderedThumbnail(candidate, event.currentTarget)}
                            />
                            {savingCandidateId === candidate.id ? <span>Saving...</span> : null}
                        </button>
                    ))}
                </div>

                {!loading && candidates.length === 0 ? (
                    <div className="muted">No image candidates loaded.</div>
                ) : null}
            </section>
        </div>
    );
}
