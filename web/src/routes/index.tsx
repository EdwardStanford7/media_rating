import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    createCategory,
    createEntryWithBinaryRanking,
    deleteEntry,
    getAuthOptions,
    getBinarySession,
    getFreeRankMatchup,
    getSession,
    importLegacyEntries,
    loadDashboard,
    renameEntry,
    startRerankEntry,
    submitBinaryWinner,
    submitFreeRankWinner,
    switchEntryCategory
} from "@/lib/server/actions";
import { signIn, signOut } from "@/lib/auth-client";
import { orderEntries } from "@/lib/ranking";
import { parseLegacyWorkbook, writeExportWorkbook } from "@/lib/importExport";
import type {
    BinarySessionView,
    CategoryWithEntries,
    DashboardData,
    DisplayMode,
    Entry,
    FreeRankMatchup
} from "@/lib/types";

interface ImagePickerTarget {
    entry: Entry;
    category: Pick<CategoryWithEntries, "id" | "name">;
}

interface ImageSearchCandidate {
    id: string;
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
}

const POSTER_WIDTH = 380;
const POSTER_HEIGHT = 475;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;

type AppMode = "dashboard" | "free_rank";

export const Route = createFileRoute("/")({
    loader: async () => {
        const authOptions = await getAuthOptions();
        const session = await getSession();
        if (!session?.user) {
            return { session: null, dashboard: null, authOptions };
        }

        return {
            session,
            authOptions,
            dashboard: await loadDashboard({ data: { displayMode: "ordered list" } })
        };
    },
    component: Home
});

function Home() {
    const { session, dashboard, authOptions } = Route.useLoaderData();

    if (!session?.user || !dashboard) {
        return <AuthPage authOptions={authOptions} />;
    }

    return <Dashboard initialDashboard={dashboard} userName={session.user.name} />;
}

function AuthPage({
    authOptions
}: {
    authOptions: {
        enabled: boolean;
        inviteCodeRequired: boolean;
        minPasswordLength: number;
    };
}) {
    const [error, setError] = useState<string | null>(null);

    async function handleEmailAuth(event: FormEvent<HTMLFormElement>, mode: "signin" | "signup") {
        event.preventDefault();
        setError(null);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const name = String(form.get("name") ?? email);
        const inviteCode = String(form.get("inviteCode") ?? "");

        try {
            if (mode === "signup") {
                await signUpWithEmail({ email, password, name, inviteCode });
            } else {
                await signIn.email({ email, password, callbackURL: "/" });
            }
            window.location.assign("/");
        } catch (authError) {
            setError(authError instanceof Error ? authError.message : "Authentication failed");
        }
    }

    return (
        <main className="auth-page">
            <section className="auth-panel">
                <div className="stack">
                    <div>
                        <h1>Media Rating</h1>
                        <p className="muted">Personal ranking for anything you want, such as books, movies, shows, games, etc.</p>
                    </div>
                    {error ? <div className="status">{error}</div> : null}
                </div>

                <div className="stack">
                    <form className="stack" onSubmit={(event) => handleEmailAuth(event, "signin")}>
                        <h2>Sign In</h2>
                        <input name="email" type="email" placeholder="Email" autoComplete="email" required />
                        <input
                            name="password"
                            type="password"
                            placeholder="Password"
                            autoComplete="current-password"
                            minLength={authOptions.minPasswordLength}
                            required
                        />
                        <button className="primary" type="submit">Sign In</button>
                    </form>

                    {authOptions.enabled ? (
                        <form className="stack" onSubmit={(event) => handleEmailAuth(event, "signup")}>
                            <h2>Create Account</h2>
                            <input name="name" placeholder="Name" autoComplete="name" required />
                            <input name="email" type="email" placeholder="Email" autoComplete="email" required />
                            <input
                                name="password"
                                type="password"
                                placeholder="Password"
                                autoComplete="new-password"
                                minLength={authOptions.minPasswordLength}
                                required
                            />
                            {authOptions.inviteCodeRequired ? (
                                <input
                                    name="inviteCode"
                                    type="password"
                                    placeholder="Invite code"
                                    autoComplete="off"
                                    required
                                />
                            ) : null}
                            <button type="submit">Create Account</button>
                        </form>
                    ) : (
                        <div className="status">Sign up is closed for this deployment.</div>
                    )}
                </div>
            </section>
        </main>
    );
}

async function signUpWithEmail({
    email,
    password,
    name,
    inviteCode
}: {
    email: string;
    password: string;
    name: string;
    inviteCode: string;
}) {
    const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            email,
            password,
            name,
            callbackURL: "/",
            inviteCode
        })
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "Account creation failed";
        throw new Error(message);
    }
}

function Dashboard({
    initialDashboard,
    userName
}: {
    initialDashboard: DashboardData;
    userName: string;
}) {
    const router = useRouter();
    const [dashboard, setDashboard] = useState(initialDashboard);
    const [selectedCategoryId, setSelectedCategoryId] = useState(
        initialDashboard.categories[0]?.id ?? ""
    );
    const [appMode, setAppMode] = useState<AppMode>("dashboard");
    const [displayMode, setDisplayMode] = useState<DisplayMode>("ordered list");
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [imagePickerTarget, setImagePickerTarget] = useState<ImagePickerTarget | null>(null);
    const [imageRefreshVersion, setImageRefreshVersion] = useState(0);
    const [autoImagePromptedIds, setAutoImagePromptedIds] = useState<Set<string>>(() => new Set());

    const selectedCategory = useMemo(
        () =>
            dashboard.categories.find((category) => category.id === selectedCategoryId) ??
            dashboard.categories[0] ??
            null,
        [dashboard.categories, selectedCategoryId]
    );
    const displayedEntries = selectedCategory
        ? orderEntries(selectedCategory.entries, displayMode)
        : [];

    async function refresh() {
        const nextDashboard = await loadDashboard({ data: { displayMode: "ordered list" } });
        setDashboard(nextDashboard);
        await router.invalidate();
    }

    function startBusy(label: string) {
        setBusy(true);
        setBusyLabel(label);
    }

    function finishBusy() {
        setBusy(false);
        setBusyLabel(null);
    }

    const requestImageForMatch = useCallback(
        (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => {
            if (entry.imageKey || imagePickerTarget || autoImagePromptedIds.has(entry.id)) {
                return;
            }

            setAutoImagePromptedIds((promptedIds) => new Set(promptedIds).add(entry.id));
            setImagePickerTarget({ entry, category });
        },
        [autoImagePromptedIds, imagePickerTarget]
    );

    async function handleImageSaved() {
        setImagePickerTarget(null);
        setImageRefreshVersion((version) => version + 1);
        await refresh();
    }

    async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        startBusy("Adding category...");
        setMessage(null);
        const form = new FormData(formElement);

        try {
            await createCategory({ data: { name: String(form.get("name") ?? "") } });
            formElement.reset();
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        if (!selectedCategory) {
            return;
        }

        startBusy("Starting binary rank...");
        setMessage(null);
        const form = new FormData(formElement);
        const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));

        try {
            const result = await createEntryWithBinaryRanking({
                data: {
                    categoryId: selectedCategory.id,
                    name: String(form.get("name") ?? ""),
                    firstConsumedAt
                }
            });
            formElement.reset();

            if (result.kind === "session") {
                setActiveSessionId(result.sessionId);
            }

            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleRerank(entryId: string) {
        startBusy("Preparing rerank...");
        setMessage(null);

        try {
            const result = await startRerankEntry({ data: { entryId } });
            if (result.kind === "session") {
                setActiveSessionId(result.sessionId);
            }
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleRename(entryId: string, name: string) {
        startBusy("Renaming entry...");
        setMessage(null);

        try {
            await renameEntry({ data: { entryId, name } });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleDelete(entryId: string) {
        startBusy("Deleting entry...");
        setMessage(null);

        try {
            await deleteEntry({ data: { entryId } });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleSwitch(entryId: string, targetCategoryId: string) {
        startBusy("Moving entry...");
        setMessage(null);

        try {
            const result = await switchEntryCategory({ data: { entryId, targetCategoryId } });
            if (result.kind === "session") {
                setActiveSessionId(result.sessionId);
            }
            setSelectedCategoryId(targetCategoryId);
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleImport(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        startBusy("Reading spreadsheet...");
        setMessage(null);
        const form = new FormData(formElement);
        const file = form.get("workbook");

        if (!(file instanceof File) || file.size === 0) {
            finishBusy();
            return;
        }

        try {
            await nextPaint();
            const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));
            const buffer = await file.arrayBuffer();
            setBusyLabel("Parsing spreadsheet...");
            await nextPaint();
            const parsed = await parseLegacyWorkbook(buffer, firstConsumedAt);
            setBusyLabel(`Importing ${parsed.entries.length} entries...`);
            await nextPaint();
            const result = await importLegacyEntries({ data: parsed });
            setBusyLabel("Refreshing dashboard...");
            setMessage(
                result.skippedCount > 0
                    ? `Imported ${result.importedCount} entries. Skipped ${result.skippedCount} duplicates.`
                    : `Imported ${result.importedCount} entries.`
            );
            formElement.reset();
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleExport() {
        startBusy("Preparing export...");
        setMessage(null);
        try {
            await nextPaint();
            const buffer = await writeExportWorkbook(dashboard.categories);
            const blob = new Blob([buffer], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "Media Ratings.xlsx";
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    return (
        <main className={appMode === "free_rank" ? "free-rank-shell" : "app-shell"} aria-busy={busy}>
            {busy ? <BusyOverlay label={busyLabel ?? "Working..."} /> : null}
            {imagePickerTarget ? (
                <ImagePickerModal
                    target={imagePickerTarget}
                    onClose={() => setImagePickerTarget(null)}
                    onSaved={handleImageSaved}
                />
            ) : null}
            {appMode === "free_rank" ? (
                <FreeRankScreen
                    categories={dashboard.categories}
                    onExit={() => setAppMode("dashboard")}
                    onNeedImage={requestImageForMatch}
                    onRanked={refresh}
                />
            ) : (
                <>
                    <aside className="sidebar">
                        <div className="topbar">
                            <strong>Media Rating</strong>
                            <button type="button" onClick={() => signOut().then(() => window.location.assign("/"))}>
                                Sign Out
                            </button>
                        </div>
                        <p className="muted">{userName}</p>

                        <form className="form-row" onSubmit={handleCreateCategory}>
                            <input disabled={busy} name="name" placeholder="New category" required />
                            <button disabled={busy} type="submit">Add</button>
                        </form>

                        <div className="category-list">
                            {dashboard.categories.map((category) => (
                                <button
                                    className={`category-button ${category.id === selectedCategory?.id ? "active" : ""}`}
                                    disabled={busy}
                                    key={category.id}
                                    type="button"
                                    onClick={() => setSelectedCategoryId(category.id)}
                                >
                                    <strong>{category.name}</strong>
                                    <span className="muted"> · {category.entries.length}</span>
                                </button>
                            ))}
                        </div>

                        <form className="stack panel" onSubmit={handleImport}>
                            <strong>Import xlsx</strong>
                            <input disabled={busy} name="firstConsumedAt" type="date" />
                            <input disabled={busy} name="workbook" type="file" accept=".xlsx" />
                            <button disabled={busy} type="submit">{busyLabel?.startsWith("Import") ? "Importing..." : "Import"}</button>
                        </form>
                    </aside>

                    <section className="main stack">
                        <div className="topbar">
                            <div>
                                <h1>{selectedCategory?.name ?? "Categories"}</h1>
                                <p className="muted">Ordered list rank is primary. Free-rank Elo is saved separately.</p>
                            </div>
                            <div className="row">
                                <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}>
                                    <option value="ordered list">Ordered List</option>
                                    <option value="combined">Combined</option>
                                    <option value="free_rank">Free Rank</option>
                                </select>
                                <button className="primary" type="button" onClick={() => setAppMode("free_rank")}>
                                    Switch to Free Rank Mode
                                </button>
                                <button disabled={busy} type="button" onClick={handleExport}>Export</button>
                            </div>
                        </div>

                        {message ? <div className="status">{message}</div> : null}

                        {selectedCategory ? (
                            <form className="panel form-row" onSubmit={handleCreateEntry}>
                                <input name="name" placeholder="New entry" required />
                                <input name="firstConsumedAt" type="date" />
                                <button className="primary" disabled={busy} type="submit">Add + Rank</button>
                            </form>
                        ) : null}

                        {activeSessionId ? (
                            <BinaryRankPanel
                                imageRefreshVersion={imageRefreshVersion}
                                sessionId={activeSessionId}
                                onComplete={async () => {
                                    setActiveSessionId(null);
                                    await refresh();
                                }}
                                onNeedImage={requestImageForMatch}
                            />
                        ) : null}

                        <section className="entries-grid">
                            {displayedEntries.map((entry, index) => (
                                <EntryCard
                                    displayIndex={index}
                                    entry={entry}
                                    categories={dashboard.categories}
                                    key={entry.id}
                                    selectedCategoryId={selectedCategory.id}
                                    onDelete={() => handleDelete(entry.id)}
                                    onPickImage={() => setImagePickerTarget({ entry, category: selectedCategory })}
                                    onRename={(name) => handleRename(entry.id, name)}
                                    onRerank={() => handleRerank(entry.id)}
                                    onSwitch={(targetCategoryId) => handleSwitch(entry.id, targetCategoryId)}
                                />
                            ))}
                        </section>
                    </section>
                </>
            )}
        </main>
    );
}

function BusyOverlay({ label }: { label: string }) {
    return (
        <div aria-live="polite" className="busy-overlay" role="status">
            <div className="busy-card">
                <div aria-hidden="true" className="spinner" />
                <div>
                    <strong>{label}</strong>
                    <p className="muted">Keep this tab open.</p>
                </div>
            </div>
        </div>
    );
}

function ImagePickerModal({
    target,
    onClose,
    onSaved
}: {
    target: ImagePickerTarget;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const defaultQuery = `${target.entry.name} (${target.category.name})`;
    const [query, setQuery] = useState(defaultQuery);
    const [candidates, setCandidates] = useState<ImageSearchCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const search = useCallback(async (searchQuery: string) => {
        setLoading(true);
        setError(null);

        try {
            const url = new URL("/api/image-search", window.location.origin);
            url.searchParams.set("entryId", target.entry.id);
            url.searchParams.set("query", searchQuery);
            const response = await fetch(url);
            const body = await response.json().catch(() => ({})) as {
                candidates?: ImageSearchCandidate[];
                message?: string;
            };

            if (!response.ok) {
                throw new Error(body.message ?? "Image search failed");
            }

            setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
        } catch (searchError) {
            setCandidates([]);
            setError(errorMessage(searchError));
        } finally {
            setLoading(false);
        }
    }, [target.entry.id]);

    useEffect(() => {
        setQuery(defaultQuery);
        setCandidates([]);
        void search(defaultQuery);
    }, [defaultQuery, search]);

    async function selectCandidate(candidate: ImageSearchCandidate) {
        setSavingCandidateId(candidate.id);
        setError(null);

        try {
            const blob = await imageUrlToPosterBlob(candidate.imageUrl);
            await uploadEntryImage(target.entry.id, blob);
            await onSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    async function uploadLocalFile(file: File) {
        setSavingCandidateId("local");
        setError(null);

        try {
            const objectUrl = URL.createObjectURL(file);
            try {
                const blob = await imageUrlToPosterBlob(objectUrl);
                await uploadEntryImage(target.entry.id, blob);
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

    return (
        <div className="modal-backdrop">
            <section className="image-picker-modal">
                <div className="toolbar">
                    <div>
                        <h2>Pick Image</h2>
                        <p className="muted">{target.entry.name} - {target.category.name}</p>
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
                        onChange={(event) => setQuery(event.target.value)}
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

                <label className="file-button">
                    <span>Upload File</span>
                    <input
                        accept="image/*"
                        disabled={loading || Boolean(savingCandidateId)}
                        type="file"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) {
                                void uploadLocalFile(file);
                            }
                        }}
                    />
                </label>

                {error ? <div className="status">{error}</div> : null}
                {loading ? <div className="status">Searching for images...</div> : null}

                <div className="image-picker-grid">
                    {candidates.map((candidate) => (
                        <button
                            className="image-candidate"
                            disabled={Boolean(savingCandidateId)}
                            key={candidate.id}
                            type="button"
                            onClick={() => void selectCandidate(candidate)}
                        >
                            <img alt="" src={candidate.thumbnailUrl} loading="lazy" decoding="async" />
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

function EntryCard({
    entry,
    displayIndex,
    categories,
    selectedCategoryId,
    onDelete,
    onPickImage,
    onRename,
    onRerank,
    onSwitch
}: {
    entry: Entry;
    displayIndex: number;
    categories: CategoryWithEntries[];
    selectedCategoryId: string;
    onDelete: () => void;
    onPickImage: () => void;
    onRename: (name: string) => void;
    onRerank: () => void;
    onSwitch: (targetCategoryId: string) => void;
}) {
    const [renameValue, setRenameValue] = useState(entry.name);
    const [targetCategoryId, setTargetCategoryId] = useState(selectedCategoryId);

    useEffect(() => {
        setRenameValue(entry.name);
        setTargetCategoryId(selectedCategoryId);
    }, [entry.name, selectedCategoryId]);

    return (
        <article className="entry-card">
            <EntryPoster entry={entry} />
            <div className="entry-card-body">
                <strong>#{displayIndex + 1} {entry.name}</strong>
                <div className="metric-row">
                    <span className="metric">Binary {entry.rankPosition + 1}</span>
                    <span className="metric">Elo {Math.round(entry.freeRankElo)}</span>
                    <span className="metric">{entry.freeRankWins}-{entry.freeRankLosses}</span>
                    {entry.firstConsumedAt ? (
                        <span className="metric">{formatDate(entry.firstConsumedAt)}</span>
                    ) : null}
                </div>
                <div className="entry-actions two-buttons">
                    <button type="button" onClick={onRerank}>Rerank</button>
                    <button type="button" onClick={onPickImage}>
                        {entry.imageKey ? "Change Image" : "Pick Image"}
                    </button>
                </div>
                <div className="entry-actions">
                    <input
                        aria-label={`Rename ${entry.name}`}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <button type="button" onClick={() => onRename(renameValue)}>Rename</button>
                </div>
                <div className="entry-actions">
                    <select
                        aria-label={`Move ${entry.name}`}
                        value={targetCategoryId}
                        onChange={(event) => setTargetCategoryId(event.target.value)}
                    >
                        {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                    <button
                        disabled={targetCategoryId === selectedCategoryId}
                        type="button"
                        onClick={() => onSwitch(targetCategoryId)}
                    >
                        Move
                    </button>
                </div>
                <button className="danger" type="button" onClick={onDelete}>Delete</button>
            </div>
        </article>
    );
}

function EntryPoster({ entry }: { entry: Entry }) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    if (entry.imageKey && !imageFailed) {
        return (
            <img
                className="entry-poster"
                src={`/api/images/${entry.id}`}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className="entry-poster image-placeholder">
            <span>{entry.name}</span>
            <small>No image</small>
        </div>
    );
}

function BinaryRankPanel({
    sessionId,
    imageRefreshVersion,
    onComplete,
    onNeedImage
}: {
    sessionId: string;
    imageRefreshVersion: number;
    onComplete: () => Promise<void>;
    onNeedImage: (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => void;
}) {
    const [session, setSession] = useState<BinarySessionView | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getBinarySession({ data: { sessionId } })
            .then(setSession)
            .catch((loadError) => setError(errorMessage(loadError)));
    }, [sessionId, imageRefreshVersion]);

    useEffect(() => {
        if (!session) {
            return;
        }

        const missingImageEntry = !session.subject.imageKey
            ? session.subject
            : !session.opponent.imageKey
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
        try {
            const result = await submitBinaryWinner({ data: { sessionId, winnerId } });
            if (result.kind === "completed") {
                await onComplete();
                return;
            }

            setSession(await getBinarySession({ data: { sessionId } }));
        } catch (submitError) {
            setError(errorMessage(submitError));
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
                <strong>Binary Rank · {session.categoryName}</strong>
                <span className="muted">
                    Range {session.lowerBound + 1}-{session.upperBound + 1} · {session.comparisonCount} matches
                </span>
            </div>
            <div className="match-grid">
                <button className="match-choice" type="button" onClick={() => chooseWinner(session.subject.id)}>
                    <MatchPoster entry={session.subject} />
                    <strong>{session.subject.name}</strong>
                </button>
                <button className="match-choice" type="button" onClick={() => chooseWinner(session.opponent.id)}>
                    <MatchPoster entry={session.opponent} />
                    <strong>{session.opponent.name}</strong>
                </button>
            </div>
        </section>
    );
}

function FreeRankScreen({
    categories,
    onExit,
    onNeedImage,
    onRanked
}: {
    categories: CategoryWithEntries[];
    onExit: () => void;
    onNeedImage: (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => void;
    onRanked: () => Promise<void>;
}) {
    const [categorySelection, setCategorySelection] = useState<string | "any">("any");
    const [matchup, setMatchup] = useState<FreeRankMatchup | null>(null);
    const [loading, setLoading] = useState(false);
    const [ranking, setRanking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadMatchup = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setMatchup(await getFreeRankMatchup({ data: { categorySelection } }));
        } catch (loadError) {
            setError(errorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [categorySelection]);

    useEffect(() => {
        void loadMatchup();
    }, [loadMatchup]);

    useEffect(() => {
        setMatchup((currentMatchup) => {
            if (!currentMatchup) {
                return currentMatchup;
            }

            const category = categories.find((candidate) => candidate.id === currentMatchup.categoryId);
            const entryA = category?.entries.find((entry) => entry.id === currentMatchup.entryA.id);
            const entryB = category?.entries.find((entry) => entry.id === currentMatchup.entryB.id);

            if (!entryA || !entryB) {
                return currentMatchup;
            }

            if (entryA === currentMatchup.entryA && entryB === currentMatchup.entryB) {
                return currentMatchup;
            }

            return {
                ...currentMatchup,
                entryA,
                entryB
            };
        });
    }, [categories]);

    useEffect(() => {
        if (!matchup) {
            return;
        }

        const missingImageEntry = !matchup.entryA.imageKey
            ? matchup.entryA
            : !matchup.entryB.imageKey
                ? matchup.entryB
                : null;

        if (missingImageEntry) {
            onNeedImage(missingImageEntry, {
                id: matchup.categoryId,
                name: matchup.categoryName
            });
        }
    }, [matchup, onNeedImage]);

    async function chooseWinner(winnerId: string) {
        if (!matchup) {
            return;
        }

        setRanking(true);
        setError(null);
        try {
            await submitFreeRankWinner({
                data: {
                    categoryId: matchup.categoryId,
                    entryAId: matchup.entryA.id,
                    entryBId: matchup.entryB.id,
                    winnerId
                }
            });
            await onRanked();
            await loadMatchup();
        } catch (submitError) {
            setError(errorMessage(submitError));
        } finally {
            setRanking(false);
        }
    }

    return (
        <section className="free-rank-screen stack">
            <div className="free-rank-topbar">
                <div>
                    <h1>Free Rank</h1>
                    {matchup ? <p className="muted">{matchup.categoryName}</p> : null}
                </div>
                <div className="row">
                    <select value={categorySelection} onChange={(event) => setCategorySelection(event.target.value)}>
                        <option value="any">Any</option>
                        {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                    <button disabled={loading || ranking} type="button" onClick={() => void loadMatchup()}>Skip</button>
                    <button type="button" onClick={onExit}>Back to List</button>
                </div>
            </div>

            {error ? <div className="status">{error}</div> : null}

            {loading ? <div className="status">Loading matchup...</div> : null}

            {matchup ? (
                <div className="free-rank-match-grid">
                    <button
                        className="free-rank-choice"
                        disabled={loading || ranking}
                        type="button"
                        onClick={() => void chooseWinner(matchup.entryA.id)}
                    >
                        <MatchPoster entry={matchup.entryA} />
                        <span>
                            <strong>{matchup.entryA.name}</strong>
                            <small>{Math.round(matchup.entryA.freeRankElo)} Elo</small>
                        </span>
                    </button>
                    <button
                        className="free-rank-choice"
                        disabled={loading || ranking}
                        type="button"
                        onClick={() => void chooseWinner(matchup.entryB.id)}
                    >
                        <MatchPoster entry={matchup.entryB} />
                        <span>
                            <strong>{matchup.entryB.name}</strong>
                            <small>{Math.round(matchup.entryB.freeRankElo)} Elo</small>
                        </span>
                    </button>
                </div>
            ) : !loading ? (
                <div className="muted">No active matchup selected.</div>
            ) : null}
        </section>
    );
}

function MatchPoster({ entry }: { entry: Entry }) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    if (entry.imageKey && !imageFailed) {
        return (
            <img
                className="match-poster"
                src={`/api/images/${entry.id}`}
                alt=""
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className="match-poster image-placeholder">
            <span>{entry.name}</span>
            <small>No image</small>
        </div>
    );
}

function dateInputToTimestamp(value: string) {
    return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(new Date(timestamp));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

async function imageUrlToPosterBlob(imageUrl: string) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error("Image could not be loaded");
    }

    return imageBlobToPosterBlob(await response.blob());
}

function imageBlobToPosterBlob(blob: Blob) {
    if (blob.size > MAX_LOCAL_IMAGE_BYTES) {
        throw new Error("Image file is too large");
    }

    return new Promise<Blob>((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);

        image.onload = () => {
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

                const targetRatio = POSTER_WIDTH / POSTER_HEIGHT;
                const sourceRatio = sourceWidth / sourceHeight;
                let cropX = 0;
                let cropY = 0;
                let cropWidth = sourceWidth;
                let cropHeight = sourceHeight;

                if (sourceRatio > targetRatio) {
                    cropWidth = sourceHeight * targetRatio;
                    cropX = (sourceWidth - cropWidth) / 2;
                } else {
                    cropHeight = sourceWidth / targetRatio;
                    cropY = (sourceHeight - cropHeight) / 2;
                }

                canvas.width = POSTER_WIDTH;
                canvas.height = POSTER_HEIGHT;
                context.drawImage(
                    image,
                    cropX,
                    cropY,
                    cropWidth,
                    cropHeight,
                    0,
                    0,
                    POSTER_WIDTH,
                    POSTER_HEIGHT
                );

                canvas.toBlob(
                    (posterBlob) => {
                        if (!posterBlob) {
                            reject(new Error("Image could not be saved"));
                            return;
                        }

                        resolve(posterBlob);
                    },
                    "image/jpeg",
                    0.9
                );
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Image could not be loaded"));
        };
        image.src = objectUrl;
    });
}

async function uploadEntryImage(entryId: string, blob: Blob) {
    const response = await fetch(`/api/images/${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: {
            "content-type": blob.type || "image/jpeg"
        },
        body: blob
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "Image upload failed";
        throw new Error(message);
    }
}

function nextPaint() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}
