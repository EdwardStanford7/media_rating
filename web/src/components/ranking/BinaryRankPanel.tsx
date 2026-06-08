import { useEffect, useState } from "react";
import { redirectIfUnauthorized } from "@/lib/errors";
import { errorMessage } from "@/lib/format";
import { hasStoredImage, isNoImageKey, shouldPromptForImage } from "@/lib/images";
import { getBinarySession, submitBinaryWinner } from "@/server/rankingSessions";
import type { BinarySessionView, CategoryWithEntries, Entry } from "@/lib/types";

export function BinaryRankPanel({
    sessionId,
    imageRefreshVersion,
    onCancel,
    onComplete,
    onUnavailable,
    onNeedImage
}: {
    sessionId: string;
    imageRefreshVersion: number;
    onCancel: (session: BinarySessionView) => Promise<void>;
    onComplete: (sessionId: string) => Promise<void>;
    onUnavailable: (sessionId: string) => Promise<void>;
    onNeedImage: (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => void;
}) {
    const [session, setSession] = useState<BinarySessionView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let isCurrent = true;
        setSession(null);
        setError(null);
        getBinarySession({ data: { sessionId } })
            .then((nextSession) => {
                if (!isCurrent) {
                    return;
                }

                if (!nextSession) {
                    void onUnavailable(sessionId);
                    return;
                }

                setSession(nextSession);
            })
            .catch((loadError) => {
                if (isCurrent && !redirectIfUnauthorized(loadError)) {
                    setError(errorMessage(loadError));
                }
            });

        return () => {
            isCurrent = false;
        };
    }, [sessionId, imageRefreshVersion]);

    useEffect(() => {
        if (!session) {
            return;
        }

        const missingImageEntry = shouldPromptForImage(session.subject.imageKey)
            ? session.subject
            : shouldPromptForImage(session.opponent.imageKey)
                ? session.opponent
                : null;

        if (missingImageEntry) {
            onNeedImage(missingImageEntry, {
                id: session.categoryId,
                name: session.categoryName
            });
        }
    }, [session, onNeedImage]);

    async function chooseWinner(winnerId: string) {
        setError(null);
        setSubmitting(true);
        try {
            const result = await submitBinaryWinner({ data: { sessionId, winnerId } });
            if (result.kind === "completed") {
                await onComplete(sessionId);
                return;
            }

            const nextSession = await getBinarySession({ data: { sessionId } });
            if (!nextSession) {
                await onUnavailable(sessionId);
                return;
            }

            setSession(nextSession);
        } catch (submitError) {
            if (!redirectIfUnauthorized(submitError)) {
                setError(errorMessage(submitError));
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function cancelRanking() {
        if (!session) {
            return;
        }

        setError(null);
        setSubmitting(true);
        try {
            await onCancel(session);
        } catch (cancelError) {
            if (!redirectIfUnauthorized(cancelError)) {
                setError(errorMessage(cancelError));
            }
        } finally {
            setSubmitting(false);
        }
    }

    if (error) {
        return <div className="status">{error}</div>;
    }

    if (!session) {
        return <section className="rank-panel">Loading ranking...</section>;
    }

    return (
        <section className="rank-panel stack">
            <div className="toolbar">
                <div>
                    <strong>
                        {session.phase === "local_repair"
                            ? "Local Repair"
                            : "Binary Rank"} · {session.categoryName}
                    </strong>
                    <p className="muted rank-meta">
                        Range {session.lowerBound + 1}-{session.upperBound + 1} · {session.comparisonCount} comparisons
                    </p>
                </div>
                {session.source === "new_entry" || session.source === "rerank_entry" ? (
                    <button
                        className="small-button"
                        disabled={submitting}
                        type="button"
                        onClick={() => void cancelRanking()}
                    >
                        {session.source === "rerank_entry"
                            ? "Cancel Rerank"
                            : "Cancel Add"}
                    </button>
                ) : null}
            </div>
            <div className="match-grid">
                <button
                    className="match-choice"
                    disabled={submitting}
                    type="button"
                    onClick={() => void chooseWinner(session.subject.id)}
                >
                    <MatchPoster entry={session.subject} />
                    <strong>{session.subject.name}</strong>
                </button>
                <button
                    className="match-choice"
                    disabled={submitting}
                    type="button"
                    onClick={() => void chooseWinner(session.opponent.id)}
                >
                    <MatchPoster entry={session.opponent} />
                    <strong>{session.opponent.name}</strong>
                </button>
            </div>
        </section>
    );
}

function MatchPoster({ entry }: { entry: Entry }) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    if (hasStoredImage(entry.imageKey) && !imageFailed) {
        return (
            <img
                className="match-poster"
                src={`/api/images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                alt=""
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className="match-poster image-placeholder">
            <span>{entry.name}</span>
            <small>{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
        </div>
    );
}
