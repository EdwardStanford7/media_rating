import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import {
    DEFAULT_STAR_RATING_CURVE,
    orderEntries,
    starRatingScaleMax,
    starRatingsByEntryId
} from "@/lib/ranking";
import { loadPublicProfile, setProfileFriend } from "@/lib/server/actions";
import type { CategoryWithEntries, Entry, PublicProfileData } from "@/lib/types";

export const Route = createFileRoute("/u/$profileSlug")({
    loader: async ({ params }) => {
        return loadPublicProfile({ data: { profileSlug: params.profileSlug } });
    },
    component: PublicProfileRoute
});

function PublicProfileRoute() {
    const loaderData = Route.useLoaderData();
    const [profileData, setProfileData] = useState<PublicProfileData | null>(loaderData);
    const [friendSaving, setFriendSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
        loaderData?.categories[0]?.id ?? null
    );

    useEffect(() => {
        setProfileData(loaderData);
        setError(null);
        setSelectedCategoryId(loaderData?.categories[0]?.id ?? null);
    }, [loaderData]);

    async function handleFriendToggle() {
        if (!profileData || profileData.viewer.isSelf) {
            return;
        }

        setFriendSaving(true);
        setError(null);

        try {
            const nextFriendState = !profileData.viewer.isFriend;
            await setProfileFriend({
                data: {
                    profileUserId: profileData.profile.userId,
                    isFriend: nextFriendState
                }
            });
            setProfileData({
                ...profileData,
                profile: {
                    ...profileData.profile,
                    isFriend: nextFriendState
                },
                viewer: {
                    ...profileData.viewer,
                    isFriend: nextFriendState
                }
            });
        } catch (friendError) {
            setError(friendError instanceof Error ? friendError.message : String(friendError));
        } finally {
            setFriendSaving(false);
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
            <PublicProfileTopbar signedIn={viewer.isSignedIn} />

            <section className="public-profile-header">
                <PublicProfileAvatar
                    imageKey={profile.imageKey}
                    isSelf={viewer.isSelf}
                    userId={profile.userId}
                />
                <div>
                    <h1>{profile.name}</h1>
                    <p className="muted">@{profile.slug}</p>
                </div>
                <div className="public-profile-actions">
                    {viewer.isSelf ? (
                        <Link className="small-button" to="/profile">Edit Profile</Link>
                    ) : viewer.isSignedIn ? (
                        <button disabled={friendSaving} type="button" onClick={() => void handleFriendToggle()}>
                            {friendSaving ? "Saving..." : viewer.isFriend ? "Remove Friend" : "Add Friend"}
                        </button>
                    ) : (
                        <Link className="small-button" to="/">Sign In</Link>
                    )}
                </div>
            </section>

            {error ? <div className="status public-profile-status">{error}</div> : null}

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
                <span>Rankly</span>
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
    const starCurve = category.starRatingCurve ?? DEFAULT_STAR_RATING_CURVE;
    const starScale = starRatingScaleMax(starCurve);
    const starRatings = useMemo(() => starRatingsByEntryId(entries, starCurve), [entries, starCurve]);

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
                        starRating={starRatings.get(entry.id) ?? starScale}
                        usePrivateImages={usePrivateImages}
                    />
                ))}
            </div>
        </section>
    );
}

function PublicEntryRow({
    entry,
    starRating,
    usePrivateImages
}: {
    entry: Entry;
    starRating: number;
    usePrivateImages: boolean;
}) {
    return (
        <article className="public-entry-row">
            <span className="public-rank-number">#{entry.rankPosition + 1}</span>
            <PublicEntryPoster entry={entry} usePrivateImages={usePrivateImages} />
            <div>
                <strong>{entry.name}</strong>
                <p className="muted">{formatRatingNumber(starRating)} stars</p>
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

function formatRatingNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}