import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
    addFriendByProfileSlug,
    getSession,
    loadProfileSettings,
    removeFriend,
    updateCategoryVisibility,
    updateUserProfile
} from "@/lib/server/actions";
import { hasStoredImage } from "@/lib/images";
import type { FriendProfileSummary, ProfileSettingsData } from "@/lib/types";

const AVATAR_SIZE = 256;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;

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
    const [friendInput, setFriendInput] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingProfileImage, setSavingProfileImage] = useState(false);
    const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
    const [savingFriendId, setSavingFriendId] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setSettings(loaderData.settings);
        setDisplayName(loaderData.settings?.user.name ?? "");
        setProfileSlug(loaderData.settings?.user.slug ?? "");
        setProfileIsPublic(loaderData.settings?.user.isPublic ?? false);
    }, [loaderData.settings]);

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

    async function handleAddFriend(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSavingFriendId("new");
        setStatus(null);
        setError(null);

        try {
            await addFriendByProfileSlug({ data: { profileSlugOrUrl: friendInput } });
            setFriendInput("");
            await refreshSettings();
            setStatus("Friend saved.");
        } catch (friendError) {
            setError(errorMessage(friendError));
        } finally {
            setSavingFriendId(null);
        }
    }

    async function handleRemoveFriend(friend: FriendProfileSummary) {
        setSavingFriendId(friend.userId);
        setStatus(null);
        setError(null);

        try {
            await removeFriend({ data: { friendUserId: friend.userId } });
            await refreshSettings();
            setStatus("Friend removed.");
        } catch (friendError) {
            setError(errorMessage(friendError));
        } finally {
            setSavingFriendId(null);
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

    if (!loaderData.session?.user || !settings) {
        return (
            <main className="standalone-page">
                <section className="standalone-panel">
                    <Link className="brand-link" to="/">
                        <img alt="" src="/favicon.svg" />
                        <span>Rankly</span>
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
            <header className="profile-page-header">
                <Link className="brand-link" to="/">
                    <img alt="" src="/favicon.svg" />
                    <span>Rankly</span>
                </Link>
                <nav className="profile-page-nav" aria-label="Profile navigation">
                    <Link to="/">Rankings</Link>
                    <Link to="/u/$profileSlug" params={{ profileSlug: settings.user.slug }}>Public Profile</Link>
                </nav>
            </header>

            <div className="profile-page-grid">
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

                    {error ? <div className="status">{error}</div> : null}
                    {status ? <div className="status success-status">{status}</div> : null}

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

                <section className="profile-panel">
                    <div className="section-heading-row">
                        <h2>Friends</h2>
                        <span className="muted">{settings.friends.length}</span>
                    </div>
                    <form className="friend-add-form" onSubmit={handleAddFriend}>
                        <input
                            aria-label="Friend handle or profile link"
                            placeholder="handle or profile link"
                            value={friendInput}
                            onChange={(event) => setFriendInput(event.target.value)}
                        />
                        <button disabled={savingFriendId === "new" || !friendInput.trim()} type="submit">
                            {savingFriendId === "new" ? "Saving..." : "Add"}
                        </button>
                    </form>
                    {settings.friends.length > 0 ? (
                        <div className="friend-list">
                            {settings.friends.map((friend) => (
                                <div className="friend-row" key={friend.userId}>
                                    <ProfileAvatar imageKey={friend.imageKey} userId={friend.userId} />
                                    <div>
                                        <Link to="/u/$profileSlug" params={{ profileSlug: friend.slug }}>
                                            {friend.name}
                                        </Link>
                                        <p className="muted">
                                            @{friend.slug} · {friend.publicCategoryCount} public rankings
                                        </p>
                                    </div>
                                    <button
                                        disabled={savingFriendId === friend.userId}
                                        type="button"
                                        onClick={() => void handleRemoveFriend(friend)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state compact">
                            <div className="empty-state-icon">+</div>
                            <div>
                                <strong>No Friends</strong>
                                <p className="muted">Saved profiles appear here.</p>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </main>
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
