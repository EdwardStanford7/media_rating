import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ListOrdered } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BrandLink } from "@/components/ui/BrandLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { showToast } from "@/lib/toast";
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

const POSTER_CLASS =
    "aspect-[4/5] bg-[image:linear-gradient(135deg,var(--poster-start),var(--poster-end))] text-center text-muted-foreground";

export const Route = createFileRoute("/u/$profileSlug")({
    loader: async ({ params }) => {
        const data = await loadPublicProfile({ data: { profileSlug: params.profileSlug } });
        if (!data) {
            throw notFound();
        }

        return data;
    },
    component: PublicProfileRoute,
    notFoundComponent: ProfileNotFound
});

function ProfileNotFound() {
    return (
        <main className="grid min-h-screen content-start gap-4 bg-background px-[clamp(1rem,3vw,2.25rem)] py-5 text-foreground">
            <PublicProfileTopbar signedIn={false} />
            <Card className="grid w-[min(100%,34rem)] gap-4 px-4 shadow-panel">
                <h1 className="text-2xl font-bold">Profile Not Found</h1>
                <p className="text-muted-foreground">This profile is private or does not exist.</p>
            </Card>
        </main>
    );
}

function PublicProfileRoute() {
    const loaderData = Route.useLoaderData();
    const [profileData, setProfileData] = useState<PublicProfileData | null>(loaderData);
    const [followSaving, setFollowSaving] = useState(false);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
        loaderData?.categories[0]?.id ?? null
    );

    useEffect(() => {
        setProfileData(loaderData);
        setSelectedCategoryId(loaderData?.categories[0]?.id ?? null);
    }, [loaderData]);

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
            showToast(message, "success");
        } catch (followError) {
            if (redirectIfUnauthorized(followError)) {
                return;
            }

            showToast(followError instanceof Error ? followError.message : String(followError), "danger");
        } finally {
            setFollowSaving(false);
        }
    }

    if (!profileData) {
        return (
            <main className="grid min-h-screen content-start gap-4 bg-background px-[clamp(1rem,3vw,2.25rem)] py-5 text-foreground">
                <PublicProfileTopbar signedIn={false} />
                <Card className="grid w-[min(100%,34rem)] gap-4 px-4 shadow-panel">
                    <h1 className="text-2xl font-bold">Profile Not Found</h1>
                    <p className="text-muted-foreground">This profile is private or does not exist.</p>
                </Card>
            </main>
        );
    }

    const { profile, viewer } = profileData;

    return (
        <main className="grid min-h-screen content-start gap-4 bg-background px-[clamp(1rem,3vw,2.25rem)] py-5 text-foreground">
            <PublicProfileTopbar signedIn={viewer.isSignedIn} />

            <Card className="min-w-0 flex-row items-center justify-end gap-[0.8rem] px-4 shadow-panel">
                <PublicProfileAvatar
                    imageKey={profile.imageKey}
                    isSelf={viewer.isSelf}
                    userId={profile.userId}
                />
                <div>
                    <h1 className="text-2xl font-bold">{profile.name}</h1>
                    <p className="text-muted-foreground">
                        @{profile.slug}
                        {!viewer.isSelf && viewer.isSignedIn
                            ? ` · ${followRelationLabel(viewer.relationState)}`
                            : null}
                    </p>
                </div>
                <div className="flex justify-end">
                    {viewer.isSelf ? (
                        <Button asChild variant="outline">
                            <Link to="/profile">Edit Profile</Link>
                        </Button>
                    ) : viewer.isSignedIn ? (
                        <Button
                            disabled={followSaving}
                            type="button"
                            onClick={() => void handleFollowAction()}
                        >
                            {followSaving ? "Saving..." : followButtonLabel(viewer.relationState)}
                        </Button>
                    ) : (
                        <Button asChild variant="outline">
                            <Link to="/">Sign In</Link>
                        </Button>
                    )}
                </div>
            </Card>

            {profileData.categories.length > 0 ? (
                <div className="m-0 grid w-full grid-cols-[220px_minmax(0,1fr)] items-start overflow-hidden rounded-md border border-border bg-card shadow-panel max-[820px]:grid-cols-1">
                    <nav className="sticky top-0 grid max-h-screen content-start gap-0.5 overflow-y-auto border-r border-border bg-sidebar p-[0.65rem] max-[820px]:static max-[820px]:flex max-[820px]:max-h-none max-[820px]:flex-row max-[820px]:flex-nowrap max-[820px]:gap-1 max-[820px]:overflow-x-auto max-[820px]:overflow-y-hidden max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:p-2" aria-label="Categories">
                        {profileData.categories.map((category) => {
                            const isActive = category.id === selectedCategoryId;
                            return (
                                <button
                                    className={`w-full rounded-sm border px-[0.65rem] py-2 text-left shadow-none enabled:hover:border-border enabled:hover:bg-secondary max-[820px]:w-auto max-[820px]:flex-none ${
                                        isActive
                                            ? "border-primary bg-accent font-bold text-accent-strong"
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
                <EmptyState className="m-0 w-full" icon={ListOrdered} title="No Shared Rankings">
                    Shared lists will appear here.
                </EmptyState>
            )}
        </main>
    );
}

function PublicProfileTopbar({ signedIn }: { signedIn: boolean }) {
    return (
        <header className="m-0 flex w-full items-center justify-between gap-4">
            <BrandLink />
            <nav className="flex items-center gap-[0.8rem]" aria-label="Profile navigation">
                {signedIn ? (
                    <>
                        <Link className="text-foreground no-underline hover:text-accent-strong" to="/">Rankings</Link>
                        <Link className="text-foreground no-underline hover:text-accent-strong" to="/profile">Profile</Link>
                    </>
                ) : (
                    <Link className="text-foreground no-underline hover:text-accent-strong" to="/">Sign In</Link>
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
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{category.name}</h2>
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
        <article className="grid grid-cols-[3.2rem_5rem_minmax(0,1fr)] items-center gap-[0.65rem] rounded-md border border-border bg-muted px-[0.55rem] py-[0.65rem]">
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
            <span className={`${POSTER_CLASS} grid w-20 content-center place-items-center gap-[0.35rem] overflow-hidden rounded-sm border border-border p-1`}>
                <small className="text-[0.95rem] leading-tight text-muted-foreground">{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
            </span>
        );
    }

    return (
        <span className={`${POSTER_CLASS} block w-20 overflow-hidden rounded-sm border border-border`}>
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
    const src = hasStoredImage(imageKey)
        ? isSelf
            ? `/api/profile-image?v=${encodeURIComponent(imageKey ?? "")}`
            : `/api/public-profile-image/${encodeURIComponent(userId)}`
        : null;

    return (
        <Avatar aria-hidden="true" className="size-16">
            {src ? <AvatarImage alt="" decoding="async" src={src} /> : null}
            <AvatarFallback className="border border-avatar-line [background:radial-gradient(circle_at_50%_38%,var(--avatar-ink)_0_21%,transparent_22%),radial-gradient(circle_at_50%_110%,var(--avatar-ink)_0_39%,transparent_40%),var(--avatar-bg)]" />
        </Avatar>
    );
}
