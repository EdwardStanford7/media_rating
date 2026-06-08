import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/errors";
import { errorMessage } from "@/lib/format";
import { hasStoredImage, isNoImageKey, shouldPromptForImage } from "@/lib/images";
import { getBinarySession, submitBinaryWinner } from "@/server/rankingSessions";
import type { BinarySessionView, CategoryWithEntries, Entry } from "@/lib/types";

const RANK_PANEL_CLASS =
    "max-w-full min-w-0 rounded-md border border-border bg-card p-4 shadow-panel";
const STATUS_CLASS =
    "rounded-sm border-l-4 border-l-gold bg-status px-3 py-[0.6rem] whitespace-pre-line";
const POSTER_CLASS =
    "aspect-[4/5] bg-[image:linear-gradient(135deg,var(--poster-start),var(--poster-end))] text-center text-muted-foreground";

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
        return <div className={STATUS_CLASS}>{error}</div>;
    }

    if (!session) {
        return <section className={RANK_PANEL_CLASS}>Loading ranking...</section>;
    }

    return (
        <section className={`${RANK_PANEL_CLASS} grid content-start gap-[0.9rem]`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-[0.7rem] max-[820px]:flex-col max-[820px]:items-stretch *:max-w-full *:min-w-0">
                <div>
                    <strong>
                        {session.phase === "local_repair"
                            ? "Local Repair"
                            : "Binary Rank"} · {session.categoryName}
                    </strong>
                    <p className="m-0 mt-[0.2rem] text-muted-foreground">
                        Range {session.lowerBound + 1}-{session.upperBound + 1} · {session.comparisonCount} comparisons
                    </p>
                </div>
                {session.source === "new_entry" || session.source === "rerank_entry" ? (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={submitting}
                        type="button"
                        onClick={() => void cancelRanking()}
                    >
                        {session.source === "rerank_entry"
                            ? "Cancel Rerank"
                            : "Cancel Add"}
                    </Button>
                ) : null}
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-4 max-[820px]:grid-cols-1">
                <button
                    className="cursor-pointer overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={submitting}
                    type="button"
                    onClick={() => void chooseWinner(session.subject.id)}
                >
                    <MatchPoster entry={session.subject} />
                    <strong className="block p-[0.7rem]">{session.subject.name}</strong>
                </button>
                <button
                    className="cursor-pointer overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={submitting}
                    type="button"
                    onClick={() => void chooseWinner(session.opponent.id)}
                >
                    <MatchPoster entry={session.opponent} />
                    <strong className="block p-[0.7rem]">{session.opponent.name}</strong>
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
                className={`${POSTER_CLASS} block h-auto w-full max-w-full object-cover`}
                src={`/api/images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                alt=""
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className={`${POSTER_CLASS} grid content-center place-items-center gap-[0.35rem] p-4`}>
            <span className="text-[1rem] leading-tight">{entry.name}</span>
            <small className="text-[0.95rem] leading-tight text-muted-foreground">{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
        </div>
    );
}
