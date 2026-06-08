import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { updateCategoryVisibility } from "@/server/categories";
import {
    approveFollowRequest,
    cancelFollowRequest,
    declineFollowRequest,
    followProfile,
    loadProfileSettings,
    removeFollow,
    requestFollowByProfileSlug,
    searchPublicProfiles,
    updateUserProfile
} from "@/server/profiles";
import { getSession } from "@/server/session";
import { AVATAR_CLASS, LINK_BUTTON_CLASS, PAGE_HEADER_CLASS, PAGE_NAV_CLASS, PAGE_NAV_LINK_CLASS, PROFILE_PAGE_CLASS, PROFILE_PANEL_CLASS, SECTION_HEADING_CLASS, STANDALONE_PANEL_CLASS } from "@/components/ui/classes";
import { Button } from "@/components/ui/button";
import { BrandLink } from "@/components/ui/BrandLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { showToast } from "@/lib/toast";
import { redirectIfUnauthorized } from "@/lib/errors";
import { canViewProfile, followRelationLabel } from "@/lib/follows";
import { hasStoredImage } from "@/lib/images";
import type { FollowProfileSummary, FollowSearchResult, ProfileSettingsData } from "@/lib/types";

const AVATAR_SIZE = 256;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;
const FOLLOW_SEARCH_DELAY_MS = 250;

export const Route = createFileRoute("/profile")({
    loader: async () => {
        const session = await getSession();
        if (!session?.user) {
            return { session: null, settings: null };
        }

        return {
            session,
            settings: await loadProfileSettings()
        };
    },
    component: ProfileRoute
});

function ProfileRoute() {
    const loaderData = Route.useLoaderData();
    const [settings, setSettings] = useState<ProfileSettingsData | null>(loaderData.settings);
    const [displayName, setDisplayName] = useState(loaderData.settings?.user.name ?? "");
    const [profileSlug, setProfileSlug] = useState(loaderData.settings?.user.slug ?? "");
    const [profileIsPublic, setProfileIsPublic] = useState(loaderData.settings?.user.isPublic ?? false);
    const [followInput, setFollowInput] = useState("");
    const [followSearchResults, setFollowSearchResults] = useState<FollowSearchResult[]>([]);
    const [followSearchLoading, setFollowSearchLoading] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingProfileImage, setSavingProfileImage] = useState(false);
    const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
    const [savingFollowId, setSavingFollowId] = useState<string | null>(null);
    useEffect(() => {
        setSettings(loaderData.settings);
        setDisplayName(loaderData.settings?.user.name ?? "");
        setProfileSlug(loaderData.settings?.user.slug ?? "");
        setProfileIsPublic(loaderData.settings?.user.isPublic ?? false);
    }, [loaderData.settings]);

    useEffect(() => {
        const query = followInput.trim();
        if (query.length < 2 || !loaderData.session?.user) {
            setFollowSearchResults([]);
            setFollowSearchLoading(false);
            return;
        }

        let canceled = false;
        setFollowSearchLoading(true);
        const timeoutId = window.setTimeout(() => {
            searchPublicProfiles({ data: { query } })
                .then((results) => {
                    if (!canceled) {
                        setFollowSearchResults(results);
                    }
                })
                .catch((searchError) => {
                    if (!canceled) {
                        setFollowSearchResults([]);
                        setActionError(searchError);
                    }
                })
                .finally(() => {
                    if (!canceled) {
                        setFollowSearchLoading(false);
                    }
                });
        }, FOLLOW_SEARCH_DELAY_MS);

        return () => {
            canceled = true;
            window.clearTimeout(timeoutId);
        };
    }, [followInput, loaderData.session?.user]);

    function setStatus(message: string | null) {
        showToast(message, "success");
    }

    function setError(message: string | null) {
        showToast(message, "danger");
    }

    function setActionError(error: unknown) {
        if (redirectIfUnauthorized(error)) {
            return;
        }

        setError(errorMessage(error));
    }

    async function refreshSettings() {
        const nextSettings = await loadProfileSettings();
        setSettings(nextSettings);
        setDisplayName(nextSettings.user.name);
        setProfileSlug(nextSettings.user.slug);
        setProfileIsPublic(nextSettings.user.isPublic);
        return nextSettings;
    }

    async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSavingProfile(true);
        setStatus(null);
        setError(null);

        try {
            await updateUserProfile({
                data: {
                    name: displayName,
                    slug: profileSlug,
                    isPublic: profileIsPublic
                }
            });
            await refreshSettings();
            setStatus("Profile saved.");
        } catch (profileError) {
            setActionError(profileError);
        } finally {
            setSavingProfile(false);
        }
    }

    async function handleProfileImageInput(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0] ?? null;
        event.currentTarget.value = "";
        if (!file) {
            return;
        }

        setSavingProfileImage(true);
        setStatus(null);
        setError(null);

        try {
            const blob = await imageFileToAvatarBlob(file);
            const response = await fetch("/api/profile-image", {
                method: "POST",
                headers: {
                    "content-type": blob.type || "image/jpeg"
                },
                body: blob
            });
            const body = await response.json().catch(() => null) as { message?: string } | null;
            if (!response.ok) {
                throw new Error(body?.message ?? "Profile photo upload failed");
            }

            await refreshSettings();
            setStatus("Profile photo updated.");
        } catch (imageError) {
            setActionError(imageError);
        } finally {
            setSavingProfileImage(false);
        }
    }

    async function handleRemoveProfileImage() {
        setSavingProfileImage(true);
        setStatus(null);
        setError(null);

        try {
            const response = await fetch("/api/profile-image", {
                method: "DELETE"
            });
            const body = await response.json().catch(() => null) as { message?: string } | null;
            if (!response.ok) {
                throw new Error(body?.message ?? "Profile photo could not be removed");
            }

            await refreshSettings();
            setStatus("Profile photo removed.");
        } catch (imageError) {
            setActionError(imageError);
        } finally {
            setSavingProfileImage(false);
        }
    }

    async function handleCategoryVisibility(categoryId: string, isPublic: boolean) {
        setSavingCategoryId(categoryId);
        setStatus(null);
        setError(null);

        try {
            await updateCategoryVisibility({ data: { categoryId, isPublic } });
            await refreshSettings();
            setStatus("Ranking visibility saved.");
        } catch (visibilityError) {
            setActionError(visibilityError);
        } finally {
            setSavingCategoryId(null);
        }
    }

    async function handleRequestFollow(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSavingFollowId("new");
        setStatus(null);
        setError(null);

        try {
            const result = await requestFollowByProfileSlug({ data: { profileSlugOrUrl: followInput } });
            setFollowInput("");
            setFollowSearchResults([]);
            await refreshSettings();
            setStatus(result.relationState === "requested" ? "Follow request sent." : "Profile followed.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleFollowSearchResult(profile: FollowSearchResult) {
        setSavingFollowId(profile.userId);
        setStatus(null);
        setError(null);

        try {
            await followProfile({ data: { profileUserId: profile.userId } });
            await refreshSettings();
            setStatus("Profile followed.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleApproveFollow(profile: FollowProfileSummary) {
        setSavingFollowId(profile.userId);
        setStatus(null);
        setError(null);

        try {
            await approveFollowRequest({ data: { followerUserId: profile.userId } });
            await refreshSettings();
            setStatus("Follow request accepted.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleDeclineFollow(profile: FollowProfileSummary) {
        setSavingFollowId(profile.userId);
        setStatus(null);
        setError(null);

        try {
            await declineFollowRequest({ data: { followerUserId: profile.userId } });
            await refreshSettings();
            setStatus("Follow request declined.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleCancelFollow(profile: FollowProfileSummary) {
        setSavingFollowId(profile.userId);
        setStatus(null);
        setError(null);

        try {
            await cancelFollowRequest({ data: { followedUserId: profile.userId } });
            await refreshSettings();
            setStatus("Follow request canceled.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleRemoveFollow(profile: FollowProfileSummary) {
        setSavingFollowId(profile.userId);
        setStatus(null);
        setError(null);

        try {
            await removeFollow({ data: { followedUserId: profile.userId } });
            await refreshSettings();
            setStatus("Profile unfollowed.");
        } catch (followError) {
            setActionError(followError);
        } finally {
            setSavingFollowId(null);
        }
    }

    async function handleCopyProfileLink() {
        if (!settings) {
            return;
        }

        const url = `${window.location.origin}/u/${settings.user.slug}`;
        await navigator.clipboard.writeText(url);
        setStatus("Profile link copied.");
    }

    function renderSearchAction(profile: FollowSearchResult) {
        const disabled = savingFollowId === profile.userId
            || profile.relationState === "requested"
            || profile.relationState === "following"
            || profile.relationState === "mutual";
        if (profile.relationState === "incoming_request") {
            return (
                <button
                    disabled={savingFollowId === profile.userId}
                    type="button"
                    onClick={() => void handleApproveFollow(profile)}
                >
                    {savingFollowId === profile.userId ? "Saving..." : "Accept"}
                </button>
            );
        }

        return (
            <button
                disabled={disabled}
                type="button"
                onClick={() => void handleFollowSearchResult(profile)}
            >
                {savingFollowId === profile.userId
                    ? "Saving..."
                    : profile.relationState === "requested"
                        ? "Requested"
                        : profile.relationState === "following" || profile.relationState === "mutual"
                            ? "Following"
                            : "Follow"}
            </button>
        );
    }

    function renderFollowerAction(profile: FollowProfileSummary) {
        if (profile.relationState === "mutual") {
            return <span className="inline-flex min-h-[2.35rem] items-center rounded-full border border-line px-3 text-muted-foreground">Mutual</span>;
        }

        return (
            <button
                disabled={savingFollowId === profile.userId}
                type="button"
                onClick={() => void handleFollowSearchResult({ ...profile, matchKind: "public_profile" })}
            >
                {savingFollowId === profile.userId ? "Saving..." : "Follow"}
            </button>
        );
    }

    if (!loaderData.session?.user || !settings) {
        return (
            <main className="grid min-h-screen place-items-center bg-app p-8 text-ink">
                <section className={STANDALONE_PANEL_CLASS}>
                    <BrandLink />
                    <h1>Profile</h1>
                    <p className="text-muted-foreground">Sign in to edit your profile.</p>
                    <Link className="inline-flex items-center justify-center gap-[0.4rem] rounded-control border border-brand bg-brand text-on-accent no-underline" to="/">Sign In</Link>
                </section>
            </main>
        );
    }

    return (
        <main className={PROFILE_PAGE_CLASS}>
            <header className={PAGE_HEADER_CLASS}>
                <BrandLink />
                <nav className={PAGE_NAV_CLASS} aria-label="Profile navigation">
                    <Link className={PAGE_NAV_LINK_CLASS} to="/">Rankings</Link>
                    <Link className={PAGE_NAV_LINK_CLASS} to="/u/$profileSlug" params={{ profileSlug: settings.user.slug }}>Public Profile</Link>
                </nav>
            </header>

            <div className="m-0 grid w-full grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1fr)_minmax(18rem,0.82fr)] items-start gap-4 max-[1100px]:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,1fr)] max-[820px]:grid-cols-1">
                <div className="grid min-w-0 content-start gap-4">
                    <section className={PROFILE_PANEL_CLASS}>
                        <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.8rem] [&_h1]:m-0 [&_h1]:leading-[1.1]">
                            <ProfileAvatar currentUser imageKey={settings.user.imageKey} userId={settings.user.id} />
                            <div>
                                <h1>{settings.user.name}</h1>
                                <p className="text-muted-foreground">@{settings.user.slug}</p>
                                <div className="mt-[0.65rem] flex flex-wrap gap-2">
                                    <label className={`w-fit rounded-control border border-line bg-panel px-[0.8rem] py-[0.55rem] text-ink ${savingProfileImage ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
                                        <span>{savingProfileImage ? "Uploading..." : "Upload Photo"}</span>
                                        <input
                                            accept="image/*"
                                            className="absolute h-px w-px overflow-hidden [clip:rect(0,0,0,0)]"
                                            disabled={savingProfileImage}
                                            type="file"
                                            onChange={(event) => void handleProfileImageInput(event)}
                                        />
                                    </label>
                                    <button
                                        disabled={savingProfileImage || !hasStoredImage(settings.user.imageKey)}
                                        type="button"
                                        onClick={() => void handleRemoveProfileImage()}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </div>

                        <form className="grid gap-[0.8rem]" onSubmit={handleProfileSubmit}>
                            <label className="grid gap-[0.35rem]">
                                <span>Display Name</span>
                                <input
                                    required
                                    maxLength={80}
                                    value={displayName}
                                    onChange={(event) => setDisplayName(event.target.value)}
                                />
                            </label>
                            <label className="grid gap-[0.35rem]">
                                <span>Public Handle</span>
                                <input
                                    required
                                    maxLength={40}
                                    value={profileSlug}
                                    onChange={(event) => setProfileSlug(event.target.value)}
                                />
                            </label>
                            <label className="inline-flex items-center justify-start gap-[0.4rem] text-[0.86rem] text-muted-foreground">
                                <input
                                    checked={profileIsPublic}
                                    className="w-auto"
                                    type="checkbox"
                                    onChange={(event) => setProfileIsPublic(event.target.checked)}
                                />
                                <span>Public profile</span>
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <Button size="lg" disabled={savingProfile} type="submit">
                                    {savingProfile ? "Saving..." : "Save Profile"}
                                </Button>
                                <Button size="lg" variant="outline" disabled={!settings.user.isPublic} type="button" onClick={handleCopyProfileLink}>
                                    Copy Link
                                </Button>
                            </div>
                        </form>
                    </section>
                </div>

                <div className="grid min-w-0 content-start gap-4">
                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Find Profiles</h2>
                            <span className="text-muted-foreground">{followSearchLoading ? "Searching..." : "Public search"}</span>
                        </div>
                        <form className="mb-[0.8rem] grid grid-cols-[minmax(0,1fr)_auto] gap-[0.8rem]" onSubmit={handleRequestFollow}>
                            <input
                                aria-label="Profile handle, name, or profile link"
                                placeholder="search public profiles or paste a private handle"
                                value={followInput}
                                onChange={(event) => setFollowInput(event.target.value)}
                            />
                            <button disabled={savingFollowId === "new" || !followInput.trim()} type="submit">
                                {savingFollowId === "new" ? "Saving..." : "Follow"}
                            </button>
                        </form>
                        {followSearchResults.length > 0 ? (
                            <FollowProfileList
                                profiles={followSearchResults}
                                renderActions={renderSearchAction}
                            />
                        ) : followInput.trim().length >= 2 && !followSearchLoading ? (
                            <p className="m-0 text-muted-foreground">No public profiles match that search.</p>
                        ) : (
                            <p className="m-0 text-muted-foreground">
                                Public profiles appear as you type. Exact private handles can still receive follow requests.
                            </p>
                        )}
                    </section>

                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Following</h2>
                            <span className="text-muted-foreground">{settings.following.length}</span>
                        </div>
                        {settings.following.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.following}
                                renderActions={(profile) => (
                                    <button
                                        disabled={savingFollowId === profile.userId}
                                        type="button"
                                        onClick={() => void handleRemoveFollow(profile)}
                                    >
                                        {savingFollowId === profile.userId ? "Saving..." : "Unfollow"}
                                    </button>
                                )}
                            />
                        ) : (
                            <EmptyState compact glyph="+" title="Not Following Anyone">
                                Profiles you follow appear here.
                            </EmptyState>
                        )}
                    </section>

                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Followers</h2>
                            <span className="text-muted-foreground">{settings.followers.length}</span>
                        </div>
                        {settings.followers.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.followers}
                                renderActions={renderFollowerAction}
                            />
                        ) : (
                            <EmptyState compact glyph="◎" title="No Followers">
                                Accepted followers appear here.
                            </EmptyState>
                        )}
                    </section>

                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Follow Requests</h2>
                            <span className="text-muted-foreground">{settings.incomingFollowRequests.length}</span>
                        </div>
                        {settings.incomingFollowRequests.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.incomingFollowRequests}
                                renderActions={(profile) => (
                                    <div className="flex flex-wrap justify-end gap-[0.4rem]">
                                        <button
                                            disabled={savingFollowId === profile.userId}
                                            type="button"
                                            onClick={() => void handleApproveFollow(profile)}
                                        >
                                            Accept
                                        </button>
                                        <button
                                            disabled={savingFollowId === profile.userId}
                                            type="button"
                                            onClick={() => void handleDeclineFollow(profile)}
                                        >
                                            Decline
                                        </button>
                                    </div>
                                )}
                            />
                        ) : (
                            <EmptyState compact glyph="+" title="No Pending Requests">
                                Requests to follow private profiles appear here.
                            </EmptyState>
                        )}
                    </section>

                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Sent Requests</h2>
                            <span className="text-muted-foreground">{settings.outgoingFollowRequests.length}</span>
                        </div>
                        {settings.outgoingFollowRequests.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.outgoingFollowRequests}
                                renderActions={(profile) => (
                                    <button
                                        disabled={savingFollowId === profile.userId}
                                        type="button"
                                        onClick={() => void handleCancelFollow(profile)}
                                    >
                                        {savingFollowId === profile.userId ? "Saving..." : "Cancel"}
                                    </button>
                                )}
                            />
                        ) : (
                            <EmptyState compact glyph=">" title="No Sent Requests">
                                Private-profile requests you send appear here.
                            </EmptyState>
                        )}
                    </section>
                </div>

                <div className="grid min-w-0 content-start gap-4 max-[1100px]:[grid-column:1/-1] max-[820px]:[grid-column:auto]">
                    <section className={PROFILE_PANEL_CLASS}>
                        <div className={SECTION_HEADING_CLASS}>
                            <h2>Public Rankings</h2>
                            <span className="text-muted-foreground">{settings.categories.filter((category) => category.isPublic).length}</span>
                        </div>
                        {settings.categories.length > 0 ? (
                            <div className="grid gap-[0.65rem]">
                                {settings.categories.map((category) => (
                                    <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[0.8rem] rounded-panel border border-line bg-subtle-panel p-3" key={category.id}>
                                        <span>
                                            <strong>{category.name}</strong>
                                            <small className="m-0 mt-[0.15rem] block text-muted-foreground">{category.entryCount} entries</small>
                                        </span>
                                        <input
                                            checked={category.isPublic}
                                            className="w-auto"
                                            disabled={savingCategoryId === category.id}
                                            type="checkbox"
                                            onChange={(event) => void handleCategoryVisibility(category.id, event.target.checked)}
                                        />
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <EmptyState compact glyph="◎" title="No Rankings">
                                Create a category before sharing rankings.
                            </EmptyState>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}

function FollowProfileList<TProfile extends FollowProfileSummary>({
    profiles,
    renderActions
}: {
    profiles: TProfile[];
    renderActions: (profile: TProfile) => ReactNode;
}) {
    return (
        <div className="grid gap-[0.65rem]">
            {profiles.map((profile) => (
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.8rem] rounded-panel border border-line bg-subtle-panel p-[0.65rem]" key={profile.userId}>
                    <ProfileAvatar imageKey={profile.imageKey} userId={profile.userId} />
                    <div>
                        {canViewProfile(profile.isPublic, false, profile.relationState) ? (
                            <Link
                                className="font-bold text-ink no-underline hover:text-accent-strong"
                                to="/u/$profileSlug"
                                params={{ profileSlug: profile.slug }}
                            >
                                {profile.name}
                            </Link>
                        ) : (
                            <strong className="font-bold text-ink no-underline">{profile.name}</strong>
                        )}
                        <p className="m-0 mt-[0.15rem] text-muted-foreground">
                            @{profile.slug} · {profile.publicCategoryCount} public rankings ·{" "}
                            {followRelationLabel(profile.relationState)}
                        </p>
                    </div>
                    {renderActions(profile)}
                </div>
            ))}
        </div>
    );
}

function ProfileAvatar({
    currentUser = false,
    imageKey,
    userId
}: {
    currentUser?: boolean;
    imageKey: string | null;
    userId: string;
}) {
    const src = hasStoredImage(imageKey)
        ? currentUser
            ? `/api/profile-image?v=${encodeURIComponent(imageKey ?? "")}`
            : `/api/public-profile-image/${encodeURIComponent(userId)}`
        : null;

    return (
        <span className={`${AVATAR_CLASS} size-12`} aria-hidden="true">
            {src ? <img alt="" className="block h-full w-full object-cover" decoding="async" src={src} /> : null}
        </span>
    );
}

function imageFileToAvatarBlob(file: File) {
    if (file.size > MAX_LOCAL_IMAGE_BYTES) {
        throw new Error("Image file is too large");
    }

    return new Promise<Blob>((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        image.onload = () => {
            imageElementToAvatarBlob(image)
                .then(resolve)
                .catch(reject)
                .finally(() => URL.revokeObjectURL(objectUrl));
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Image could not be loaded"));
        };
        image.src = objectUrl;
    });
}

function imageElementToAvatarBlob(image: HTMLImageElement) {
    return new Promise<Blob>((resolve, reject) => {
        try {
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) {
                throw new Error("Image processing is unavailable");
            }

            const sourceWidth = image.naturalWidth;
            const sourceHeight = image.naturalHeight;
            if (sourceWidth === 0 || sourceHeight === 0) {
                throw new Error("Image has no dimensions");
            }

            const cropSize = Math.min(sourceWidth, sourceHeight);
            const cropX = (sourceWidth - cropSize) / 2;
            const cropY = (sourceHeight - cropSize) / 2;

            canvas.width = AVATAR_SIZE;
            canvas.height = AVATAR_SIZE;
            context.drawImage(
                image,
                cropX,
                cropY,
                cropSize,
                cropSize,
                0,
                0,
                AVATAR_SIZE,
                AVATAR_SIZE
            );

            canvas.toBlob(
                (avatarBlob) => {
                    if (!avatarBlob) {
                        reject(new Error("Profile photo could not be saved"));
                        return;
                    }

                    resolve(avatarBlob);
                },
                "image/jpeg",
                0.88
            );
        } catch (error) {
            reject(error);
        }
    });
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
