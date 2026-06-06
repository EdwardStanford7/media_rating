import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { followButtonLabel, followRelationLabel } from "@/lib/follows";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import { orderEntries } from "@/lib/ranking";
import {
    approveFollowRequest,
    cancelFollowRequest,
    followProfile,
    loadPublicProfile,
    removeFollow
} from "@/lib/server/actions";
import type { CategoryWithEntries, Entry, PublicProfileData } from "@/lib/types";

const TOAST_TIMEOUT_MS = 5_000;

interface PublicProfileToast {
    id: number;
    message: string;
    variant?: "default" | "success" | "danger";
}

export const Route = createFileRoute("/u/$profileSlug")({
    loader: async ({ params }) => {
        return loadPublicProfile({ data: { profileSlug: params.profileSlug } });
    },
    component: PublicProfileRoute
});

function PublicProfileRoute() {
    const loaderData = Route.useLoaderData();
    const [profileData, setProfileData] = useState<PublicProfileData | null>(loaderData);
    const [followSaving, setFollowSaving] = useState(false);
    const [toasts, setToasts] = useState<PublicProfileToast[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
        loaderData?.categories[0]?.id ?? null
    );
    const toastIdRef = useRef(0);
    const toastTimeoutsRef = useRef<Map<number, number>>(new Map());

    useEffect(() => {
        setProfileData(loaderData);
        setSelectedCategoryId(loaderData?.categories[0]?.id ?? null);
    }, [loaderData]);

    useEffect(() => () => {
        for (const timeoutId of toastTimeoutsRef.current.values()) {
            window.clearTimeout(timeoutId);
        }
        toastTimeoutsRef.current.clear();
    }, []);

    function dismissToast(toastId: number) {
        const timeoutId = toastTimeoutsRef.current.get(toastId);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            toastTimeoutsRef.current.delete(toastId);
        }

        setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
    }

    function pushToast(toast: Omit<PublicProfileToast, "id">) {
        const id = toastIdRef.current + 1;
        toastIdRef.current = id;
        setToasts((currentToasts) => [...currentToasts, { ...toast, id }]);
        const timeoutId = window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS);
        toastTimeoutsRef.current.set(id, timeoutId);
    }

    async function handleFollowAction() {
        if (!profileData || profileData.viewer.isSelf) {
            return;
        }

        setFollowSaving(true);

        try {
            const currentRelation = profileData.viewer.relationState;
            let nextRelation = currentRelation;
            let message = "Profile followed.";

            if (currentRelation === "incoming_request") {
                const result = await approveFollowRequest({
                    data: { followerUserId: profileData.profile.userId }
                });
                nextRelation = result.relationState;
                message = "Follow request accepted.";
            } else if (currentRelation === "requested") {
                await cancelFollowRequest({ data: { followedUserId: profileData.profile.userId } });
                nextRelation = "none";
                message = "Follow request canceled.";
            } else if (currentRelation === "following" || currentRelation === "mutual") {
                await removeFollow({ data: { followedUserId: profileData.profile.userId } });
                nextRelation = currentRelation === "mutual" ? "follows_you" : "none";
                message = "Profile unfollowed.";
            } else {
                const result = await followProfile({ data: { profileUserId: profileData.profile.userId } });
                nextRelation = result.relationState;
                message = nextRelation === "requested" ? "Follow request sent." : "Profile followed.";
            }

            setProfileData({
                ...profileData,
                profile: {
                    ...profileData.profile,
                    relationState: nextRelation
                },
                viewer: {
                    ...profileData.viewer,
                    relationState: nextRelation
                }
            });
            pushToast({
                message,
                variant: "success"
            });
        } catch (followError) {
            pushToast({
                message: followError instanceof Error ? followError.message : String(followError),
                variant: "danger"
            });
        } finally {
            setFollowSaving(false);
        }
    }

    if (!profileData) {
        return (
            <main className="public-profile-page">
                <PublicProfileTopbar signedIn={false} />
                <section className="standalone-panel">
                    <h1>Profile Not Found</h1>
                    <p className="muted">This profile is private or does not exist.</p>
                </section>
            </main>
        );
    }

    const { profile, viewer } = profileData;

    return (
        <main className="public-profile-page">
            <PublicProfileToastStack toasts={toasts} onDismiss={dismissToast} />
            <PublicProfileTopbar signedIn={viewer.isSignedIn} />

            <section className="public-profile-header">
                <PublicProfileAvatar
                    imageKey={profile.imageKey}
                    isSelf={viewer.isSelf}
                    userId={profile.userId}
                />
                <div>
                    <h1>{profile.name}</h1>
                    <p className="muted">
                        @{profile.slug}
                        {!viewer.isSelf && viewer.isSignedIn
                            ? ` · ${followRelationLabel(viewer.relationState)}`
                            : null}
                    </p>
                </div>
                <div className="public-profile-actions">
                    {viewer.isSelf ? (
                        <Link className="small-button" to="/profile">Edit Profile</Link>
                    ) : viewer.isSignedIn ? (
                        <button
                            disabled={followSaving}
                            type="button"
                            onClick={() => void handleFollowAction()}
                        >
                            {followSaving ? "Saving..." : followButtonLabel(viewer.relationState)}
                        </button>
                    ) : (
                        <Link className="small-button" to="/">Sign In</Link>
                    )}
                </div>
            </section>

            {profileData.categories.length > 0 ? (
                <div className="public-profile-body">
                    <nav className="public-category-sidebar" aria-label="Categories">
                        {profileData.categories.map((category) => {
                            const isActive = category.id === selectedCategoryId;
                            return (
                                <button
                                    className={`public-category-tab${isActive ? " active" : ""}`}
                                    key={category.id}
                                    type="button"
                                    aria-current={isActive ? "true" : undefined}
                                    onClick={() => setSelectedCategoryId(category.id)}
                                >
                                    <span className="public-category-tab-name">{category.name}</span>
                                </button>
                            );
                        })}
                    </nav>
                    <div className="public-category-panel">
                        {(() => {
                            const category = profileData.categories.find(
                                (c) => c.id === selectedCategoryId
                            );
                            if (!category) return null;
                            return (
                                <PublicCategory
                                    category={category}
                                    usePrivateImages={viewer.isSelf}
                                />
                            );
                        })()}
                    </div>
                </div>
            ) : (
                <section className="empty-state public-empty-state">
                    <div className="empty-state-icon">◎</div>
                    <div>
                        <strong>No Public Rankings</strong>
                        <p className="muted">Public lists will appear here.</p>
                    </div>
                </section>
            )}
        </main>
    );
}

function PublicProfileTopbar({ signedIn }: { signedIn: boolean }) {
    return (
        <header className="profile-page-header">
            <Link className="brand-link" to="/">
                <img alt="" src="/favicon.svg" />
                <span>Goldshelf</span>
            </Link>
            <nav className="profile-page-nav" aria-label="Public profile navigation">
                {signedIn ? (
                    <>
                        <Link to="/">Rankings</Link>
                        <Link to="/profile">Profile</Link>
                    </>
                ) : (
                    <Link to="/">Sign In</Link>
                )}
            </nav>
        </header>
    );
}

function PublicCategory({
    category,
    usePrivateImages
}: {
    category: CategoryWithEntries;
    usePrivateImages: boolean;
}) {
    const entries = useMemo(() => orderEntries(category.entries), [category.entries]);

    return (
        <section className="public-ranking-section">
            <div className="public-category-panel-heading">
                <h2>{category.name}</h2>
                <span className="muted">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="public-entry-list">
                {entries.map((entry) => (
                    <PublicEntryRow
                        entry={entry}
                        key={entry.id}
                        usePrivateImages={usePrivateImages}
                    />
                ))}
            </div>
        </section>
    );
}

function PublicEntryRow({
    entry,
    usePrivateImages
}: {
    entry: Entry;
    usePrivateImages: boolean;
}) {
    return (
        <article className="public-entry-row">
            <span className="public-rank-number">#{entry.rankPosition + 1}</span>
            <PublicEntryPoster entry={entry} usePrivateImages={usePrivateImages} />
            <div>
                <strong>{entry.name}</strong>
            </div>
        </article>
    );
}

function PublicEntryPoster({
    entry,
    usePrivateImages
}: {
    entry: Entry;
    usePrivateImages: boolean;
}) {
    const [failed, setFailed] = useState(false);
    const src = hasStoredImage(entry.imageKey) && !failed
        ? usePrivateImages
            ? `/api/images/${encodeURIComponent(entry.id)}`
            : `/api/public-images/${encodeURIComponent(entry.id)}`
        : null;

    if (!src) {
        return (
            <span className="public-entry-poster image-placeholder">
                <small>{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
            </span>
        );
    }

    return (
        <span className="public-entry-poster">
            <img alt="" decoding="async" loading="lazy" src={src} onError={() => setFailed(true)} />
        </span>
    );
}

function PublicProfileAvatar({
    imageKey,
    isSelf,
    userId
}: {
    imageKey: string | null;
    isSelf: boolean;
    userId: string;
}) {
    const [failed, setFailed] = useState(false);
    const src = hasStoredImage(imageKey) && !failed
        ? isSelf
            ? `/api/profile-image?v=${encodeURIComponent(imageKey ?? "")}`
            : `/api/public-profile-image/${encodeURIComponent(userId)}`
        : null;

    return (
        <span className="profile-avatar public-profile-avatar" aria-hidden="true">
            {src ? <img alt="" decoding="async" src={src} onError={() => setFailed(true)} /> : null}
        </span>
    );
}

function PublicProfileToastStack({
    onDismiss,
    toasts
}: {
    onDismiss: (toastId: number) => void;
    toasts: PublicProfileToast[];
}) {
    if (toasts.length === 0) {
        return null;
    }

    return (
        <div aria-live="polite" className="toast-stack">
            {toasts.map((toast) => (
                <div className={`toast ${toast.variant ?? "default"}`} key={toast.id} role="status">
                    <span>{toast.message}</span>
                    <button
                        aria-label="Dismiss notification"
                        className="toast-close-button"
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                    >
                        x
                    </button>
                </div>
            ))}
        </div>
    );
}
