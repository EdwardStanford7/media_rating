import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
    approveFollowRequest,
    cancelFollowRequest,
    declineFollowRequest,
    followProfile,
    getSession,
    loadProfileSettings,
    removeFollow,
    requestFollowByProfileSlug,
    searchPublicProfiles,
    updateCategoryVisibility,
    updateUserProfile
} from "@/lib/server/actions";
import { canViewProfile, followRelationLabel } from "@/lib/follows";
import { hasStoredImage } from "@/lib/images";
import type { FollowProfileSummary, FollowSearchResult, ProfileSettingsData } from "@/lib/types";

const AVATAR_SIZE = 256;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;
const TOAST_TIMEOUT_MS = 5_000;
const FOLLOW_SEARCH_DELAY_MS = 250;

interface ProfileToast {
    id: number;
    message: string;
    variant?: "default" | "success" | "danger";
}

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
    const [toasts, setToasts] = useState<ProfileToast[]>([]);
    const toastIdRef = useRef(0);
    const toastTimeoutsRef = useRef<Map<number, number>>(new Map());

    useEffect(() => {
        setSettings(loaderData.settings);
        setDisplayName(loaderData.settings?.user.name ?? "");
        setProfileSlug(loaderData.settings?.user.slug ?? "");
        setProfileIsPublic(loaderData.settings?.user.isPublic ?? false);
    }, [loaderData.settings]);

    useEffect(() => () => {
        for (const timeoutId of toastTimeoutsRef.current.values()) {
            window.clearTimeout(timeoutId);
        }
        toastTimeoutsRef.current.clear();
    }, []);

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
                        setError(errorMessage(searchError));
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

    function dismissToast(toastId: number) {
        const timeoutId = toastTimeoutsRef.current.get(toastId);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            toastTimeoutsRef.current.delete(toastId);
        }

        setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
    }

    function pushToast(toast: Omit<ProfileToast, "id">) {
        const id = toastIdRef.current + 1;
        toastIdRef.current = id;
        setToasts((currentToasts) => [...currentToasts, { ...toast, id }]);
        const timeoutId = window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS);
        toastTimeoutsRef.current.set(id, timeoutId);
    }

    function setStatus(message: string | null) {
        if (message) {
            pushToast({ message, variant: "success" });
        }
    }

    function setError(message: string | null) {
        if (message) {
            pushToast({ message, variant: "danger" });
        }
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
            setError(errorMessage(profileError));
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
            setError(errorMessage(imageError));
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
            setError(errorMessage(imageError));
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
            setError(errorMessage(visibilityError));
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
            setError(errorMessage(followError));
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
            setError(errorMessage(followError));
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
            setError(errorMessage(followError));
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
            setError(errorMessage(followError));
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
            setError(errorMessage(followError));
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
            setError(errorMessage(followError));
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
            return <span className="relation-pill">Mutual</span>;
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
            <main className="standalone-page">
                <section className="standalone-panel">
                    <Link className="brand-link" to="/">
                        <img alt="" src="/favicon.svg" />
                        <span>Goldshelf</span>
                    </Link>
                    <h1>Profile</h1>
                    <p className="muted">Sign in to edit your profile.</p>
                    <Link className="primary link-button" to="/">Sign In</Link>
                </section>
            </main>
        );
    }

    return (
        <main className="profile-page">
            <ProfileToastStack toasts={toasts} onDismiss={dismissToast} />
            <header className="profile-page-header">
                <Link className="brand-link" to="/">
                    <img alt="" src="/favicon.svg" />
                    <span>Goldshelf</span>
                </Link>
                <nav className="profile-page-nav" aria-label="Profile navigation">
                    <Link to="/">Rankings</Link>
                    <Link to="/u/$profileSlug" params={{ profileSlug: settings.user.slug }}>Public Profile</Link>
                </nav>
            </header>

            <div className="profile-page-grid">
                <div className="profile-column profile-account-column">
                    <section className="profile-panel profile-main-panel">
                        <div className="profile-title-row">
                            <ProfileAvatar currentUser imageKey={settings.user.imageKey} userId={settings.user.id} />
                            <div>
                                <h1>{settings.user.name}</h1>
                                <p className="muted">@{settings.user.slug}</p>
                                <div className="profile-avatar-actions profile-page-avatar-actions">
                                    <label className={`file-button ${savingProfileImage ? "disabled" : ""}`}>
                                        <span>{savingProfileImage ? "Uploading..." : "Upload Photo"}</span>
                                        <input
                                            accept="image/*"
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

                        <form className="profile-form" onSubmit={handleProfileSubmit}>
                            <label>
                                <span>Display Name</span>
                                <input
                                    required
                                    maxLength={80}
                                    value={displayName}
                                    onChange={(event) => setDisplayName(event.target.value)}
                                />
                            </label>
                            <label>
                                <span>Public Handle</span>
                                <input
                                    required
                                    maxLength={40}
                                    value={profileSlug}
                                    onChange={(event) => setProfileSlug(event.target.value)}
                                />
                            </label>
                            <label className="switch-row profile-switch-row">
                                <input
                                    checked={profileIsPublic}
                                    type="checkbox"
                                    onChange={(event) => setProfileIsPublic(event.target.checked)}
                                />
                                <span>Public profile</span>
                            </label>
                            <div className="profile-actions">
                                <button className="primary" disabled={savingProfile} type="submit">
                                    {savingProfile ? "Saving..." : "Save Profile"}
                                </button>
                                <button disabled={!settings.user.isPublic} type="button" onClick={handleCopyProfileLink}>
                                    Copy Link
                                </button>
                            </div>
                        </form>
                    </section>
                </div>

                <div className="profile-column profile-follow-column">
                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Find Profiles</h2>
                            <span className="muted">{followSearchLoading ? "Searching..." : "Public search"}</span>
                        </div>
                        <form className="follow-add-form" onSubmit={handleRequestFollow}>
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
                            <p className="muted compact-note">No public profiles match that search.</p>
                        ) : (
                            <p className="muted compact-note">
                                Public profiles appear as you type. Exact private handles can still receive follow requests.
                            </p>
                        )}
                    </section>

                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Following</h2>
                            <span className="muted">{settings.following.length}</span>
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
                            <FollowEmptyState
                                icon="+"
                                title="Not Following Anyone"
                                text="Profiles you follow appear here."
                            />
                        )}
                    </section>

                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Followers</h2>
                            <span className="muted">{settings.followers.length}</span>
                        </div>
                        {settings.followers.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.followers}
                                renderActions={renderFollowerAction}
                            />
                        ) : (
                            <FollowEmptyState
                                icon="◎"
                                title="No Followers"
                                text="Accepted followers appear here."
                            />
                        )}
                    </section>

                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Follow Requests</h2>
                            <span className="muted">{settings.incomingFollowRequests.length}</span>
                        </div>
                        {settings.incomingFollowRequests.length > 0 ? (
                            <FollowProfileList
                                profiles={settings.incomingFollowRequests}
                                renderActions={(profile) => (
                                    <div className="follow-row-actions">
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
                            <FollowEmptyState
                                icon="+"
                                title="No Pending Requests"
                                text="Requests to follow private profiles appear here."
                            />
                        )}
                    </section>

                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Sent Requests</h2>
                            <span className="muted">{settings.outgoingFollowRequests.length}</span>
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
                            <FollowEmptyState
                                icon=">"
                                title="No Sent Requests"
                                text="Private-profile requests you send appear here."
                            />
                        )}
                    </section>
                </div>

                <div className="profile-column profile-rankings-column">
                    <section className="profile-panel">
                        <div className="section-heading-row">
                            <h2>Public Rankings</h2>
                            <span className="muted">{settings.categories.filter((category) => category.isPublic).length}</span>
                        </div>
                        {settings.categories.length > 0 ? (
                            <div className="profile-category-list">
                                {settings.categories.map((category) => (
                                    <label className="profile-category-row" key={category.id}>
                                        <span>
                                            <strong>{category.name}</strong>
                                            <small className="muted">{category.entryCount} entries</small>
                                        </span>
                                        <input
                                            checked={category.isPublic}
                                            disabled={savingCategoryId === category.id}
                                            type="checkbox"
                                            onChange={(event) => void handleCategoryVisibility(category.id, event.target.checked)}
                                        />
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state compact">
                                <div className="empty-state-icon">◎</div>
                                <div>
                                    <strong>No Rankings</strong>
                                    <p className="muted">Create a category before sharing rankings.</p>
                                </div>
                            </div>
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
        <div className="follow-list">
            {profiles.map((profile) => (
                <div className="follow-row" key={profile.userId}>
                    <ProfileAvatar imageKey={profile.imageKey} userId={profile.userId} />
                    <div>
                        {canViewProfile(profile.isPublic, false, profile.relationState) ? (
                            <Link to="/u/$profileSlug" params={{ profileSlug: profile.slug }}>
                                {profile.name}
                            </Link>
                        ) : (
                            <strong>{profile.name}</strong>
                        )}
                        <p className="muted">
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

function FollowEmptyState({
    icon,
    text,
    title
}: {
    icon: string;
    text: string;
    title: string;
}) {
    return (
        <div className="empty-state compact">
            <div className="empty-state-icon">{icon}</div>
            <div>
                <strong>{title}</strong>
                <p className="muted">{text}</p>
            </div>
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
        <span className="profile-avatar" aria-hidden="true">
            {src ? <img alt="" decoding="async" src={src} /> : null}
        </span>
    );
}

function ProfileToastStack({
    onDismiss,
    toasts
}: {
    onDismiss: (toastId: number) => void;
    toasts: ProfileToast[];
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
