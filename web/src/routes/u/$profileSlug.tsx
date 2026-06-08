import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AVATAR_CLASS, LINK_BUTTON_CLASS, PAGE_HEADER_CLASS, PAGE_NAV_CLASS, PAGE_NAV_LINK_CLASS, POSTER_CLASS, PROFILE_PAGE_CLASS, PROFILE_PANEL_CLASS, SECTION_HEADING_CLASS, STANDALONE_PANEL_CLASS } from "@/components/ui/classes";
import { BrandLink } from "@/components/ui/BrandLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { ToastStack, type AppToast } from "@/components/ui/ToastStack";
import { redirectIfUnauthorized } from "@/lib/errors";
import { followButtonLabel, followRelationLabel } from "@/lib/follows";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import { orderEntries } from "@/lib/ranking";
import {
    approveFollowRequest,
    cancelFollowRequest,
    followProfile,
    loadPublicProfile,
    removeFollow
} from "@/server/profiles";
import type { CategoryWithEntries, Entry, PublicProfileData } from "@/lib/types";

const TOAST_TIMEOUT_MS = 5_000;

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
    const [toasts, setToasts] = useState<AppToast[]>([]);
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

    function pushToast(toast: Omit<AppToast, "id">) {
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
            if (redirectIfUnauthorized(followError)) {
                return;
            }

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
            <main className={PROFILE_PAGE_CLASS}>
                <PublicProfileTopbar signedIn={false} />
                <section className={STANDALONE_PANEL_CLASS}>
                    <h1>Profile Not Found</h1>
                    <p className="text-muted-foreground">This profile is private or does not exist.</p>
                </section>
            </main>
        );
    }

    const { profile, viewer } = profileData;

    return (
        <main className={PROFILE_PAGE_CLASS}>
            <ToastStack toasts={toasts} onDismiss={dismissToast} />
            <PublicProfileTopbar signedIn={viewer.isSignedIn} />

            <section className={`${PROFILE_PANEL_CLASS} flex items-center justify-end gap-[0.8rem] [&_h1]:m-0 [&_h1]:leading-[1.1]`}>
                <PublicProfileAvatar
                    imageKey={profile.imageKey}
                    isSelf={viewer.isSelf}
                    userId={profile.userId}
                />
                <div>
                    <h1>{profile.name}</h1>
                    <p className="text-muted-foreground">
                        @{profile.slug}
                        {!viewer.isSelf && viewer.isSignedIn
                            ? ` · ${followRelationLabel(viewer.relationState)}`
                            : null}
                    </p>
                </div>
                <div className="flex justify-end">
                    {viewer.isSelf ? (
                        <Link className={LINK_BUTTON_CLASS} to="/profile">Edit Profile</Link>
                    ) : viewer.isSignedIn ? (
                        <button
                            disabled={followSaving}
                            type="button"
                            onClick={() => void handleFollowAction()}
                        >
                            {followSaving ? "Saving..." : followButtonLabel(viewer.relationState)}
                        </button>
                    ) : (
                        <Link className={LINK_BUTTON_CLASS} to="/">Sign In</Link>
                    )}
                </div>
            </section>

            {profileData.categories.length > 0 ? (
                <div className="m-0 grid w-full grid-cols-[220px_minmax(0,1fr)] items-start overflow-hidden rounded-panel border border-line bg-panel shadow-panel max-[820px]:grid-cols-1">
                    <nav className="sticky top-0 grid max-h-screen content-start gap-[2px] overflow-y-auto border-r border-line bg-sidebar p-[0.65rem] max-[820px]:static max-[820px]:flex max-[820px]:max-h-none max-[820px]:flex-row max-[820px]:flex-nowrap max-[820px]:gap-[4px] max-[820px]:overflow-x-auto max-[820px]:overflow-y-hidden max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:p-2" aria-label="Categories">
                        {profileData.categories.map((category) => {
                            const isActive = category.id === selectedCategoryId;
                            return (
                                <button
                                    className={`w-full rounded-control border px-[0.65rem] py-2 text-left shadow-none enabled:hover:border-line enabled:hover:bg-panel-alt max-[820px]:w-auto max-[820px]:flex-none ${
                                        isActive
                                            ? "border-brand bg-selected-panel font-bold text-accent-strong"
                                            : "border-transparent bg-transparent"
                                    }`}
                                    key={category.id}
                                    type="button"
                                    aria-current={isActive ? "true" : undefined}
                                    onClick={() => setSelectedCategoryId(category.id)}
                                >
                                    <span className="block min-w-0 truncate text-[0.92rem]">{category.name}</span>
                                </button>
                            );
                        })}
                    </nav>
                    <div className="min-w-0 p-4">
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
                <EmptyState className="m-0 w-full" glyph="◎" title="No Public Rankings">
                    Public lists will appear here.
                </EmptyState>
            )}
        </main>
    );
}

function PublicProfileTopbar({ signedIn }: { signedIn: boolean }) {
    return (
        <header className={PAGE_HEADER_CLASS}>
            <BrandLink />
            <nav className={PAGE_NAV_CLASS} aria-label="Public profile navigation">
                {signedIn ? (
                    <>
                        <Link className={PAGE_NAV_LINK_CLASS} to="/">Rankings</Link>
                        <Link className={PAGE_NAV_LINK_CLASS} to="/profile">Profile</Link>
                    </>
                ) : (
                    <Link className={PAGE_NAV_LINK_CLASS} to="/">Sign In</Link>
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
        <section className="grid gap-[0.8rem]">
            <div className={SECTION_HEADING_CLASS}>
                <h2>{category.name}</h2>
                <span className="text-muted-foreground">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="grid gap-[0.65rem]">
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
        <article className="grid grid-cols-[3.2rem_5rem_minmax(0,1fr)] items-center gap-[0.65rem] rounded-panel border border-line bg-subtle-panel px-[0.55rem] py-[0.65rem]">
            <span className="font-extrabold text-muted-foreground">#{entry.rankPosition + 1}</span>
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
            <span className={`${POSTER_CLASS} grid w-20 content-center place-items-center gap-[0.35rem] overflow-hidden rounded-control border border-line p-1`}>
                <small className="text-[0.95rem] leading-[1.25] text-muted-foreground">{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
            </span>
        );
    }

    return (
        <span className={`${POSTER_CLASS} block w-20 overflow-hidden rounded-control border border-line`}>
            <img className="block h-full w-full object-cover" alt="" decoding="async" loading="lazy" src={src} onError={() => setFailed(true)} />
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
        <span className={`${AVATAR_CLASS} size-16`} aria-hidden="true">
            {src ? <img alt="" decoding="async" src={src} onError={() => setFailed(true)} /> : null}
        </span>
    );
}
