import { createFileRoute } from "@tanstack/react-router";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    cancelBinarySession,
    createCategory,
    createEntryWithBinaryRanking,
    createQueuedEntry,
    deleteCategory,
    deleteEntry,
    deleteQueuedEntry,
    getAuthOptions,
    getBinarySession,
    getSession,
    importLegacyEntries,
    loadDashboard,
    markImageUnavailable,
    moveEntryOnePosition,
    renameCategory,
    renameEntry,
    renameQueuedEntry,
    startRandomAuditRanking,
    startRerankEntry,
    startQueuedEntryRanking,
    submitBinaryWinner,
    switchEntryCategory,
    updateCategoryStarRatingCurve,
    updateQueueSettings
} from "@/lib/server/actions";
import { signIn, signOut } from "@/lib/auth-client";
import { hasStoredImage, isNoImageKey, shouldPromptForImage } from "@/lib/images";
import {
    DEFAULT_STAR_RATING_CURVE,
    generateNormalStarRatingCurve,
    orderEntries,
    parseStarRatingCurveText,
    starRatingForPercentile,
    starRatingScaleMax,
    starRatingCurveToText,
    starRatingsByEntryId
} from "@/lib/ranking";
import { parseLegacyWorkbook, writeExportWorkbook } from "@/lib/importExport";
import type {
    BinarySessionView,
    CategoryWithEntries,
    DashboardData,
    Entry,
    QueuedEntry,
    QueueSettings
} from "@/lib/types";

interface ImagePickerTarget {
    kind: "entry" | "queue";
    item: Pick<Entry | QueuedEntry, "id" | "name" | "imageKey">;
    category: Pick<CategoryWithEntries, "id" | "name">;
}

interface ImageSearchCandidate {
    id: string;
    imageUrl: string;
    thumbnailUrl: string;
    width: number;
    height: number;
}

interface RandomAuditPair {
    categoryId: string;
    categoryName: string;
    higherRanked: Entry;
    lowerRanked: Entry;
    leftEntry: Entry;
    rightEntry: Entry;
}

interface StarCurveBuilderState {
    minStars: number;
    maxStars: number;
    averageStars: number;
    withinOneStarPercent: number;
}

const POSTER_WIDTH = 380;
const POSTER_HEIGHT = 475;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_SEARCH_TIMEOUT_MS = 15_000;
const THEME_STORAGE_KEY = "media-rating-theme";
type ThemeMode = "light" | "dark";

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
            dashboard: await loadDashboard()
        };
    },
    component: Home
});

function Home() {
    const { session, dashboard, authOptions } = Route.useLoaderData();

    useEffect(() => {
        document.documentElement.dataset.theme = readInitialThemeMode();
    }, []);

    if (!session?.user || !dashboard) {
        return <AuthPage authOptions={authOptions} />;
    }

    return <Dashboard initialDashboard={dashboard} userName={session.user.name} />;
}

function AuthPage({
    authOptions
}: {
    authOptions: {
        minPasswordLength: number;
    };
}) {
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [resetToken, setResetToken] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const searchParams = new URLSearchParams(window.location.search);
        const token = searchParams.get("token");
        const resetError = searchParams.get("error");
        if (token) {
            setResetToken(token);
        } else if (resetError) {
            setError("That password reset link is invalid or expired.");
        }
    }, []);

    async function handleEmailAuth(event: FormEvent<HTMLFormElement>, mode: "signin" | "signup") {
        event.preventDefault();
        setError(null);
        setStatusMessage(null);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const name = String(form.get("name") ?? email);

        try {
            if (mode === "signup") {
                await signUpWithEmail({ email, password, name });
            } else {
                await signIn.email({ email, password, callbackURL: "/" });
            }
            window.location.assign("/");
        } catch (authError) {
            setError(authError instanceof Error ? authError.message : "Authentication failed");
        }
    }

    async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!resetToken) {
            setError("That password reset link is invalid or expired.");
            return;
        }

        setError(null);
        setStatusMessage(null);
        const form = new FormData(event.currentTarget);
        const newPassword = String(form.get("newPassword") ?? "");
        const confirmPassword = String(form.get("confirmPassword") ?? "");
        if (newPassword.length < authOptions.minPasswordLength) {
            setError(`Password must be at least ${authOptions.minPasswordLength} characters.`);
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        try {
            await resetPasswordWithToken({ token: resetToken, newPassword });
            setResetToken(null);
            setStatusMessage("Password updated. Sign in with your new password.");
            if (typeof window !== "undefined") {
                window.history.replaceState(null, "", "/");
            }
        } catch (authError) {
            setError(authError instanceof Error ? authError.message : "Password reset failed");
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
                    {statusMessage ? <div className="status">{statusMessage}</div> : null}
                </div>

                {resetToken ? (
                    <form className="stack" onSubmit={handleResetPassword}>
                        <h2>Reset Password</h2>
                        <input
                            name="newPassword"
                            type="password"
                            placeholder="New password"
                            autoComplete="new-password"
                            minLength={authOptions.minPasswordLength}
                            required
                        />
                        <input
                            name="confirmPassword"
                            type="password"
                            placeholder="Confirm new password"
                            autoComplete="new-password"
                            minLength={authOptions.minPasswordLength}
                            required
                        />
                        <button className="primary" type="submit">Update Password</button>
                    </form>
                ) : (
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
                            <button type="submit">Create Account</button>
                        </form>
                    </div>
                )}
            </section>
        </main>
    );
}

async function resetPasswordWithToken({
    token,
    newPassword
}: {
    token: string;
    newPassword: string;
}) {
    const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            token,
            newPassword
        })
    });

    if (!response.ok) {
        throw new Error(await readAuthError(response, "Password reset failed"));
    }
}

async function readAuthError(response: Response, fallback: string) {
    const text = await response.text().catch(() => "");
    const body = text ? safeJsonParse(text) : null;
    if (body && typeof body === "object") {
        if ("message" in body && typeof body.message === "string") {
            return body.message;
        }

        if ("code" in body && typeof body.code === "string") {
            return body.code.replaceAll("_", " ").toLowerCase();
        }
    }

    if (text.trim()) {
        return text.trim();
    }

    return `${fallback} (${response.status})`;
}

function safeJsonParse(text: string) {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

async function signUpWithEmail({
    email,
    password,
    name
}: {
    email: string;
    password: string;
    name: string;
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
            callbackURL: "/"
        })
    });

    if (!response.ok) {
        throw new Error(await readAuthError(response, "Account creation failed"));
    }
}

function Dashboard({
    initialDashboard,
    userName
}: {
    initialDashboard: DashboardData;
    userName: string;
}) {
    const initialActiveSessionId = initialDashboard.activeBinarySession?.id ?? null;
    const [dashboard, setDashboard] = useState(initialDashboard);
    const [selectedCategoryId, setSelectedCategoryId] = useState(
        initialDashboard.activeBinarySession?.categoryId ?? initialDashboard.categories[0]?.id ?? ""
    );
    const [entrySearch, setEntrySearch] = useState("");
    const [activeSessionId, setActiveSessionIdState] = useState<string | null>(initialActiveSessionId);
    const activeSessionIdRef = useRef<string | null>(initialActiveSessionId);
    const closedBinarySessionIdsRef = useRef<Set<string>>(new Set());
    const [queueRankMode, setQueueRankMode] = useState(false);
    const queueRankModeRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [auditPair, setAuditPair] = useState<RandomAuditPair | null>(null);
    const [imagePickerTarget, setImagePickerTarget] = useState<ImagePickerTarget | null>(null);
    const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<CategoryWithEntries | null>(null);
    const [imageRefreshVersion, setImageRefreshVersion] = useState(0);
    const [autoImagePromptedIds, setAutoImagePromptedIds] = useState<Set<string>>(() => new Set());
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
    const mainRef = useRef<HTMLElement | null>(null);

    const selectedCategory = useMemo(
        () =>
            dashboard.categories.find((category) => category.id === selectedCategoryId) ??
            dashboard.categories[0] ??
            null,
        [dashboard.categories, selectedCategoryId]
    );
    const displayedEntries = useMemo(() => {
        if (!selectedCategory) {
            return [];
        }

        const searchTerm = entrySearch.trim().toLowerCase();
        const entries = searchTerm
            ? selectedCategory.entries.filter((entry) => entry.name.toLowerCase().includes(searchTerm))
            : selectedCategory.entries;

        return orderEntries(entries);
    }, [entrySearch, selectedCategory]);
    const activeStarRatingCurve = selectedCategory?.starRatingCurve ?? dashboard.queueSettings.starRatingCurve;
    const starRatings = useMemo(() => {
        if (!selectedCategory || !dashboard.queueSettings.showStarRatings) {
            return new Map<string, number>();
        }

        return starRatingsByEntryId(selectedCategory.entries, activeStarRatingCurve);
    }, [
        activeStarRatingCurve,
        dashboard.queueSettings.showStarRatings,
        selectedCategory
    ]);
    const starRatingScale = useMemo(
        () => starRatingScaleMax(activeStarRatingCurve),
        [activeStarRatingCurve]
    );

    function setActiveBinarySessionId(sessionId: string | null) {
        activeSessionIdRef.current = sessionId;
        setActiveSessionIdState(sessionId);
    }

    function markBinarySessionClosed(sessionId: string | null) {
        if (sessionId) {
            closedBinarySessionIdsRef.current.add(sessionId);
        }
    }

    useEffect(() => {
        document.documentElement.dataset.theme = themeMode;
        window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }, [themeMode]);

    useEffect(() => {
        setAuditPair(null);
    }, [selectedCategoryId]);

    useEffect(() => {
        if (
            !dashboard.activeBinarySession ||
            activeSessionId ||
            closedBinarySessionIdsRef.current.has(dashboard.activeBinarySession.id)
        ) {
            return;
        }

        setActiveBinarySessionId(dashboard.activeBinarySession.id);
        setSelectedCategoryId(dashboard.activeBinarySession.categoryId);
    }, [activeSessionId, dashboard.activeBinarySession]);

    async function refresh() {
        const nextDashboard = await loadDashboard();
        setDashboard(nextDashboard);
        return nextDashboard;
    }

    function setQueueRankingActive(isActive: boolean) {
        queueRankModeRef.current = isActive;
        setQueueRankMode(isActive);
    }

    function startBusy(label: string) {
        setBusy(true);
        setBusyLabel(label);
    }

    function finishBusy() {
        setBusy(false);
        setBusyLabel(null);
    }

    function scrollMainToTop() {
        window.requestAnimationFrame(() => {
            mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

    const requestImageForMatch = useCallback(
        (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => {
            if (
                !dashboard.queueSettings.promptForMissingImages ||
                !shouldPromptForImage(entry.imageKey) ||
                imagePickerTarget ||
                autoImagePromptedIds.has(entry.id)
            ) {
                return;
            }

            setAutoImagePromptedIds((promptedIds) => new Set(promptedIds).add(entry.id));
            setImagePickerTarget({ kind: "entry", item: entry, category });
        },
        [autoImagePromptedIds, dashboard.queueSettings.promptForMissingImages, imagePickerTarget]
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

    async function handleRenameCategory(categoryId: string, name: string) {
        startBusy("Renaming category...");
        setMessage(null);

        try {
            await renameCategory({ data: { categoryId, name } });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleDeleteCategory(category: CategoryWithEntries) {
        const nextCategory = dashboard.categories.find((candidate) => candidate.id !== category.id);
        setCategoryDeleteTarget(null);
        startBusy("Deleting category...");
        setMessage(null);

        try {
            await deleteCategory({ data: { categoryId: category.id } });
            setSelectedCategoryId(nextCategory?.id ?? "");
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

        startBusy("Adding entry...");
        setMessage(null);
        const form = new FormData(formElement);
        const name = String(form.get("name") ?? "");
        const cleanName = name.trim();
        const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));

        try {
            if (dashboard.queueSettings.enabled) {
                const result = await createQueuedEntry({
                    data: {
                        categoryId: selectedCategory.id,
                        name,
                        firstConsumedAt
                    }
                });
                formElement.reset();
                setMessage(`Queued ${cleanName} for ranking on ${formatDateTime(result.availableAt)}.`);
                if (dashboard.queueSettings.promptForMissingImages) {
                    setImagePickerTarget({
                        kind: "queue",
                        item: {
                            id: result.queuedEntryId,
                            name: cleanName,
                            imageKey: null
                        },
                        category: selectedCategory
                    });
                }
                await refresh();
                return;
            }

            const result = await createEntryWithBinaryRanking({
                data: {
                    categoryId: selectedCategory.id,
                    name,
                    firstConsumedAt
                }
            });
            formElement.reset();

            if (result.kind === "session") {
                setActiveBinarySessionId(result.sessionId);
            }

            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleQueueSettings(settings: QueueSettings, options: { quiet?: boolean } = {}) {
        if (!options.quiet) {
            startBusy("Saving queue settings...");
        }
        setMessage(null);

        try {
            await updateQueueSettings({ data: settings });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            if (!options.quiet) {
                finishBusy();
            }
        }
    }

    async function handleCategoryStarRatingCurve(
        categoryId: string,
        starRatingCurve: QueueSettings["starRatingCurve"] | null,
        options: { quiet?: boolean } = {}
    ) {
        if (!options.quiet) {
            startBusy("Saving category settings...");
        }
        setMessage(null);

        try {
            await updateCategoryStarRatingCurve({ data: { categoryId, starRatingCurve } });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            if (!options.quiet) {
                finishBusy();
            }
        }
    }

    function getNextReadyQueuedEntry(queuedEntries: QueuedEntry[]) {
        const currentTime = Date.now();
        return queuedEntries
            .filter((entry) => entry.availableAt <= currentTime)
            .sort((left, right) => left.availableAt - right.availableAt || left.createdAt - right.createdAt)[0] ?? null;
    }

    async function beginQueuedEntryRanking(entry: QueuedEntry, overrideDelay: boolean) {
        const result = await startQueuedEntryRanking({
            data: {
                queuedEntryId: entry.id,
                overrideDelay
            }
        });

        setSelectedCategoryId(entry.categoryId);
        if (result.kind === "session") {
            setActiveBinarySessionId(result.sessionId);
        } else {
            setMessage(`${entry.name} was added as the first ranked entry in ${entry.categoryName}.`);
        }

        const nextDashboard = await refresh();
        return { result, nextDashboard };
    }

    async function startNextQueuedRank(queuedEntries: QueuedEntry[]) {
        if (!queueRankModeRef.current) {
            return;
        }

        const nextEntry = getNextReadyQueuedEntry(queuedEntries);
        if (!nextEntry) {
            setQueueRankingActive(false);
            setMessage("No ready queued entries remain.");
            return;
        }

        startBusy("Starting queued rank...");
        setMessage(null);

        try {
            const { result, nextDashboard } = await beginQueuedEntryRanking(nextEntry, false);
            if (result.kind !== "session" && queueRankModeRef.current) {
                await startNextQueuedRank(nextDashboard.queuedEntries);
            }
        } catch (error) {
            setQueueRankingActive(false);
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleStartQueuedEntry(entry: QueuedEntry) {
        setQueueRankingActive(false);
        startBusy("Starting queued rank...");
        setMessage(null);

        try {
            await beginQueuedEntryRanking(entry, true);
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleStartQueueRank() {
        setQueueRankingActive(true);
        await startNextQueuedRank(dashboard.queuedEntries);
    }

    function handleStopQueueRank() {
        setQueueRankingActive(false);
        setMessage(activeSessionId ? "Queue ranking will stop after the current item." : "Queue ranking stopped.");
    }

    async function handleDeleteQueuedEntry(entry: QueuedEntry) {
        startBusy("Removing queued entry...");
        setMessage(null);

        try {
            await deleteQueuedEntry({ data: { queuedEntryId: entry.id } });
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleRenameQueuedEntry(entry: QueuedEntry, name: string) {
        startBusy("Renaming queued entry...");
        setMessage(null);

        try {
            await renameQueuedEntry({ data: { queuedEntryId: entry.id, name } });
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
        setAuditPair(null);

        try {
            const result = await startRerankEntry({ data: { entryId } });
            if (result.kind === "session") {
                setActiveBinarySessionId(result.sessionId);
                scrollMainToTop();
            }
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    function handleStartRandomAudit() {
        if (!selectedCategory || selectedCategory.entries.length < 2 || activeSessionId) {
            return;
        }

        const orderedEntries = orderEntries(selectedCategory.entries);
        const firstIndex = Math.floor(Math.random() * orderedEntries.length);
        let secondIndex = Math.floor(Math.random() * (orderedEntries.length - 1));
        if (secondIndex >= firstIndex) {
            secondIndex += 1;
        }

        const higherIndex = Math.min(firstIndex, secondIndex);
        const lowerIndex = Math.max(firstIndex, secondIndex);
        const displayEntries = Math.random() < 0.5
            ? [orderedEntries[higherIndex], orderedEntries[lowerIndex]]
            : [orderedEntries[lowerIndex], orderedEntries[higherIndex]];
        setMessage(null);
        setAuditPair({
            categoryId: selectedCategory.id,
            categoryName: selectedCategory.name,
            higherRanked: orderedEntries[higherIndex],
            lowerRanked: orderedEntries[lowerIndex],
            leftEntry: displayEntries[0],
            rightEntry: displayEntries[1]
        });
        scrollMainToTop();
    }

    async function handleAuditWinner(winnerId: string) {
        if (!auditPair) {
            return;
        }

        startBusy("Starting audit repair...");
        setAuditPair(null);
        setMessage(null);

        try {
            const result = await startRandomAuditRanking({
                data: {
                    categoryId: auditPair.categoryId,
                    entryAId: auditPair.higherRanked.id,
                    entryBId: auditPair.lowerRanked.id,
                    winnerId
                }
            });
            if (result.kind === "session") {
                setActiveBinarySessionId(result.sessionId);
                scrollMainToTop();
            } else {
                setMessage(result.changed
                    ? "Random audit repaired the list."
                    : "Random audit confirmed the current order.");
            }
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleMoveEntry(entryId: string, direction: "up" | "down") {
        startBusy(direction === "up" ? "Moving entry up..." : "Moving entry down...");
        setMessage(null);

        try {
            await moveEntryOnePosition({ data: { entryId, direction } });
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
                setActiveBinarySessionId(result.sessionId);
            }
            setSelectedCategoryId(targetCategoryId);
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleCancelBinarySession(session: BinarySessionView) {
        startBusy(
            session.operationKind === "random_audit"
                ? "Cancelling audit..."
                : session.source === "rerank_entry"
                    ? "Cancelling rerank..."
                    : "Cancelling add..."
        );
        setMessage(null);
        setQueueRankingActive(false);

        try {
            await cancelBinarySession({ data: { sessionId: session.id } });
            markBinarySessionClosed(session.id);
            setActiveBinarySessionId(null);
            setMessage(
                session.operationKind === "random_audit"
                    ? "Cancelled random audit."
                    : session.source === "rerank_entry"
                        ? `Cancelled reranking ${session.subject.name}.`
                        : `Cancelled adding ${session.subject.name}.`
            );
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            finishBusy();
        }
    }

    async function handleMissingBinarySession(sessionId: string) {
        if (
            closedBinarySessionIdsRef.current.has(sessionId) ||
            activeSessionIdRef.current !== sessionId
        ) {
            return;
        }

        markBinarySessionClosed(sessionId);
        setActiveBinarySessionId(null);
        setQueueRankingActive(false);
        const nextDashboard = await refresh();
        if (
            nextDashboard.activeBinarySession &&
            !closedBinarySessionIdsRef.current.has(nextDashboard.activeBinarySession.id)
        ) {
            setActiveBinarySessionId(nextDashboard.activeBinarySession.id);
            setSelectedCategoryId(nextDashboard.activeBinarySession.categoryId);
            return;
        }

        setMessage("That ranking is no longer active.");
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
        <main className="app-shell" aria-busy={busy}>
            {busy ? <BusyOverlay label={busyLabel ?? "Working..."} /> : null}
            {imagePickerTarget ? (
                <ImagePickerModal
                    target={imagePickerTarget}
                    onClose={() => setImagePickerTarget(null)}
                    onSaved={handleImageSaved}
                />
            ) : null}
            {categoryDeleteTarget ? (
                <ConfirmDialog
                    confirmLabel="Delete Category"
                    title={`Delete ${categoryDeleteTarget.name}?`}
                    variant="danger"
                    onCancel={() => setCategoryDeleteTarget(null)}
                    onConfirm={() => void handleDeleteCategory(categoryDeleteTarget)}
                >
                    <p>
                        This permanently removes {categoryDeleteTarget.entries.length} ranked {categoryDeleteTarget.entries.length === 1 ? "entry" : "entries"},
                        {" "}
                        {dashboard.queuedEntries.filter((entry) => entry.categoryId === categoryDeleteTarget.id).length} queued {dashboard.queuedEntries.filter((entry) => entry.categoryId === categoryDeleteTarget.id).length === 1 ? "entry" : "entries"},
                        {" "}and stored images for this category.
                    </p>
                </ConfirmDialog>
            ) : null}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <strong className="brand-title">Media Rating</strong>
                    <AccountMenu
                        busy={busy}
                        busyLabel={busyLabel}
                        listLocked={Boolean(activeSessionId)}
                        selectedCategory={selectedCategory}
                        settings={dashboard.queueSettings}
                        onExport={handleExport}
                        onImport={handleImport}
                        onSaveCategoryStarRatingCurve={handleCategoryStarRatingCurve}
                        onSaveSettings={handleQueueSettings}
                        onThemeChange={setThemeMode}
                        themeMode={themeMode}
                        userName={userName}
                    />
                </div>

                <form className="form-row" onSubmit={handleCreateCategory}>
                    <input disabled={busy} name="name" placeholder="New category" required />
                    <button disabled={busy} type="submit">Add</button>
                </form>

                <div className="category-list">
                    {dashboard.categories.map((category) => (
                        <CategoryListItem
                            category={category}
                            isActive={category.id === selectedCategory?.id}
                            key={category.id}
                            busy={busy}
                            listLocked={Boolean(activeSessionId)}
                            onDelete={() => setCategoryDeleteTarget(category)}
                            onRename={(name) => handleRenameCategory(category.id, name)}
                            onSelect={() => setSelectedCategoryId(category.id)}
                        />
                    ))}
                </div>

                <QueuePanel
                    activeSessionId={activeSessionId}
                    busy={busy}
                    queueRankMode={queueRankMode}
                    queuedEntries={dashboard.queuedEntries}
                    onDelete={handleDeleteQueuedEntry}
                    onPickImage={(entry) => setImagePickerTarget({
                        kind: "queue",
                        item: entry,
                        category: {
                            id: entry.categoryId,
                            name: entry.categoryName
                        }
                    })}
                    onStartQueue={handleStartQueueRank}
                    onRename={handleRenameQueuedEntry}
                    onStart={handleStartQueuedEntry}
                    onStopQueue={handleStopQueueRank}
                />

            </aside>

            <section className="main stack" ref={mainRef}>
                <div className="topbar">
                    <div>
                        <h1>{selectedCategory?.name ?? "Categories"}</h1>
                    </div>
                    <button
                        disabled={busy || Boolean(activeSessionId) || !selectedCategory || selectedCategory.entries.length < 2}
                        type="button"
                        onClick={handleStartRandomAudit}
                    >
                        Random Audit
                    </button>
                </div>

                {message ? <div className="status">{message}</div> : null}

                {selectedCategory && !activeSessionId ? (
                    <div className="entry-control-stack">
                        <form className="entry-create-form" onSubmit={handleCreateEntry}>
                            <input disabled={busy} name="name" placeholder="New entry" required />
                            <div className="entry-create-row">
                                <input
                                    className="date-input"
                                    disabled={busy}
                                    name="firstConsumedAt"
                                    type="date"
                                />
                                <button className="primary" disabled={busy} type="submit">
                                    {dashboard.queueSettings.enabled ? "Add to Queue" : "Add + Rank"}
                                </button>
                            </div>
                        </form>

                        <div className="entry-search-row">
                            <input
                                aria-label="Search entries"
                                value={entrySearch}
                                placeholder="Search entries"
                                onChange={(event) => setEntrySearch(event.target.value)}
                            />
                        </div>
                    </div>
                ) : null}

                {activeSessionId ? (
                    <BinaryRankPanel
                        imageRefreshVersion={imageRefreshVersion}
                        sessionId={activeSessionId}
                        onCancel={handleCancelBinarySession}
                        onComplete={async (sessionId) => {
                            markBinarySessionClosed(sessionId);
                            if (activeSessionIdRef.current === sessionId) {
                                setActiveBinarySessionId(null);
                            }
                            const nextDashboard = await refresh();
                            if (queueRankModeRef.current) {
                                await startNextQueuedRank(nextDashboard.queuedEntries);
                            }
                        }}
                        onUnavailable={handleMissingBinarySession}
                        onNeedImage={requestImageForMatch}
                    />
                ) : null}

                {auditPair && !activeSessionId ? (
                    <RandomAuditPanel
                        pair={auditPair}
                        onCancel={() => setAuditPair(null)}
                        onNeedImage={requestImageForMatch}
                        onChoose={(winnerId) => void handleAuditWinner(winnerId)}
                    />
                ) : null}

                <section className="entries-grid">
                    {selectedCategory ? displayedEntries.map((entry) => (
                        <EntryCard
                            entry={entry}
                            categories={dashboard.categories}
                            key={entry.id}
                            canMoveDown={entry.rankPosition < selectedCategory.entries.length - 1}
                            canMoveUp={entry.rankPosition > 0}
                            listLocked={Boolean(activeSessionId)}
                            selectedCategoryId={selectedCategory.id}
                            starRating={dashboard.queueSettings.showStarRatings
                                ? starRatings.get(entry.id) ?? starRatingScale
                                : null}
                            starRatingScale={starRatingScale}
                            onDelete={() => handleDelete(entry.id)}
                            onMoveDown={() => handleMoveEntry(entry.id, "down")}
                            onMoveUp={() => handleMoveEntry(entry.id, "up")}
                            onPickImage={() => setImagePickerTarget({
                                kind: "entry",
                                item: entry,
                                category: selectedCategory
                            })}
                            onRename={(name) => handleRename(entry.id, name)}
                            onRerank={() => handleRerank(entry.id)}
                            onSwitch={(targetCategoryId) => handleSwitch(entry.id, targetCategoryId)}
                        />
                    )) : null}
                </section>
                {selectedCategory && displayedEntries.length === 0 ? (
                    <div className="muted">No entries match that search.</div>
                ) : null}
            </section>
        </main>
    );
}

function useEscapeKey(isActive: boolean, onEscape: () => void) {
    useEffect(() => {
        if (!isActive) {
            return;
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onEscape();
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isActive, onEscape]);
}

function readInitialThemeMode(): ThemeMode {
    if (typeof window === "undefined") {
        return "light";
    }

    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
        return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useDismissibleMenu<T extends HTMLElement>(isOpen: boolean, onDismiss: () => void) {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        function handlePointerDown(event: PointerEvent) {
            const element = ref.current;
            const target = event.target;
            if (!element || !(target instanceof Node) || element.contains(target)) {
                return;
            }

            onDismiss();
        }

        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [isOpen, onDismiss]);

    useEscapeKey(isOpen, onDismiss);

    return ref;
}

function useFloatingMenu(isOpen: boolean) {
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = useState<CSSProperties>({
        left: 0,
        position: "fixed",
        top: 0,
        visibility: "hidden"
    });

    const updatePosition = useCallback(() => {
        if (!isOpen || typeof window === "undefined") {
            return;
        }

        const trigger = triggerRef.current;
        const panel = panelRef.current;
        if (!trigger || !panel) {
            return;
        }

        const margin = 8;
        const gap = 6;
        const triggerRect = trigger.getBoundingClientRect();
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;

        const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
        const preferredLeft = triggerRect.right - panelWidth;
        const preferredTop = triggerRect.bottom + gap;
        const flippedTop = triggerRect.top - panelHeight - gap;

        const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
        const topCandidate =
            preferredTop + panelHeight + margin > window.innerHeight ? flippedTop : preferredTop;
        const top = Math.max(margin, Math.min(topCandidate, maxTop));

        setStyle({
            left,
            position: "fixed",
            top,
            visibility: "visible",
            zIndex: 80
        });
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setStyle({
                left: 0,
                position: "fixed",
                top: 0,
                visibility: "hidden"
            });
            return;
        }

        updatePosition();
        const frameId = window.requestAnimationFrame(updatePosition);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [isOpen, updatePosition]);

    return { panelRef, style, triggerRef };
}

function ConfirmDialog({
    children,
    confirmLabel,
    title,
    variant = "default",
    onCancel,
    onConfirm
}: {
    children: ReactNode;
    confirmLabel: string;
    title: string;
    variant?: "default" | "danger";
    onCancel: () => void;
    onConfirm: () => void;
}) {
    useEscapeKey(true, onCancel);

    return (
        <div
            className="modal-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onCancel();
                }
            }}
        >
            <section
                aria-labelledby="confirm-dialog-title"
                aria-modal="true"
                className="confirm-modal"
                role="dialog"
            >
                <div>
                    <h2 id="confirm-dialog-title">{title}</h2>
                    <div className="muted">{children}</div>
                </div>
                <div className="confirm-actions">
                    <button type="button" onClick={onCancel}>Cancel</button>
                    <button
                        className={variant === "danger" ? "danger" : "primary"}
                        type="button"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </section>
        </div>
    );
}

function CategoryListItem({
    category,
    isActive,
    busy,
    listLocked,
    onDelete,
    onRename,
    onSelect
}: {
    category: CategoryWithEntries;
    isActive: boolean;
    busy: boolean;
    listLocked: boolean;
    onDelete: () => void;
    onRename: (name: string) => Promise<void>;
    onSelect: () => void;
}) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [name, setName] = useState(category.name);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen);

    useEffect(() => {
        setName(category.name);
        setIsRenaming(false);
        setMenuOpen(false);
    }, [category.name]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(name);
        setIsRenaming(false);
    }

    if (isRenaming) {
        return (
            <form className="category-rename-form" onSubmit={handleSubmit}>
                <input
                    autoFocus
                    disabled={busy}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
                <div className="category-rename-actions">
                    <button disabled={busy} type="submit">Save</button>
                    <button
                        disabled={busy}
                        type="button"
                        onClick={() => {
                            setName(category.name);
                            setIsRenaming(false);
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        );
    }

    return (
        <div className="category-row">
            <button
                className={`category-button ${isActive ? "active" : ""}`}
                disabled={busy}
                type="button"
                onClick={onSelect}
            >
                <strong>{category.name}</strong>
                <span className="muted"> · {category.entries.length}</span>
            </button>
            <div className="category-menu" ref={menuRef}>
                <button
                    aria-expanded={menuOpen}
                    aria-label={`Category actions for ${category.name}`}
                    className="category-menu-button"
                    disabled={busy}
                    ref={floatingMenu.triggerRef}
                    type="button"
                    onClick={() => setMenuOpen((isOpen) => !isOpen)}
                >
                    ...
                </button>
                {menuOpen ? (
                    <div
                        className="category-menu-panel floating-menu-panel"
                        ref={floatingMenu.panelRef}
                        style={floatingMenu.style}
                    >
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                setIsRenaming(true);
                            }}
                        >
                            Rename
                        </button>
                        <button
                            className="danger menu-danger"
                            disabled={busy || listLocked}
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                onDelete();
                            }}
                        >
                            Delete
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
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

function AccountMenu({
    busy,
    busyLabel,
    listLocked,
    selectedCategory,
    settings,
    onExport,
    onImport,
    onSaveCategoryStarRatingCurve,
    onSaveSettings,
    onThemeChange,
    themeMode,
    userName
}: {
    busy: boolean;
    busyLabel: string | null;
    listLocked: boolean;
    selectedCategory: CategoryWithEntries | null;
    settings: QueueSettings;
    onExport: () => Promise<void>;
    onImport: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onSaveCategoryStarRatingCurve: (
        categoryId: string,
        starRatingCurve: QueueSettings["starRatingCurve"] | null,
        options?: { quiet?: boolean }
    ) => Promise<void>;
    onSaveSettings: (settings: QueueSettings, options?: { quiet?: boolean }) => Promise<void>;
    onThemeChange: (themeMode: ThemeMode) => void;
    themeMode: ThemeMode;
    userName: string;
}) {
    const [enabled, setEnabled] = useState(settings.enabled);
    const [delayDays, setDelayDays] = useState(settings.delayDays);
    const [promptForMissingImages, setPromptForMissingImages] = useState(settings.promptForMissingImages);
    const [showStarRatings, setShowStarRatings] = useState(settings.showStarRatings);
    const [starCurveText, setStarCurveText] = useState(starRatingCurveToText(settings.starRatingCurve));
    const [useCategoryStarCurve, setUseCategoryStarCurve] = useState(Boolean(selectedCategory?.starRatingCurve));
    const [categoryStarCurveText, setCategoryStarCurveText] = useState(
        starRatingCurveToText(selectedCategory?.starRatingCurve ?? settings.starRatingCurve)
    );
    const [globalCurveBuilder, setGlobalCurveBuilder] = useState(() => curveBuilderDefaults(settings.starRatingCurve));
    const [categoryCurveBuilder, setCategoryCurveBuilder] = useState(() =>
        curveBuilderDefaults(selectedCategory?.starRatingCurve ?? settings.starRatingCurve)
    );
    const [starCurveError, setStarCurveError] = useState<string | null>(null);
    const [categoryStarCurveError, setCategoryStarCurveError] = useState<string | null>(null);
    const [quickSaving, setQuickSaving] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<"settings" | "import" | null>(null);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen);
    const importDisabled = busy || listLocked;

    useEffect(() => {
        setEnabled(settings.enabled);
        setDelayDays(settings.delayDays);
        setPromptForMissingImages(settings.promptForMissingImages);
        setShowStarRatings(settings.showStarRatings);
        setStarCurveText(starRatingCurveToText(settings.starRatingCurve));
        setUseCategoryStarCurve(Boolean(selectedCategory?.starRatingCurve));
        setCategoryStarCurveText(starRatingCurveToText(selectedCategory?.starRatingCurve ?? settings.starRatingCurve));
        setGlobalCurveBuilder(curveBuilderDefaults(settings.starRatingCurve));
        setCategoryCurveBuilder(curveBuilderDefaults(selectedCategory?.starRatingCurve ?? settings.starRatingCurve));
        setStarCurveError(null);
        setCategoryStarCurveError(null);
    }, [
        selectedCategory?.id,
        selectedCategory?.starRatingCurve,
        settings.delayDays,
        settings.enabled,
        settings.promptForMissingImages,
        settings.starRatingCurve,
        settings.showStarRatings
    ]);

    async function handleExportClick() {
        await onExport();
        setMenuOpen(false);
    }

    async function handleImportSubmit(event: FormEvent<HTMLFormElement>) {
        await onImport(event);
        setMenuOpen(false);
    }

    async function saveSettingsImmediately(nextSettings: QueueSettings) {
        setQuickSaving(true);
        try {
            await onSaveSettings(nextSettings, { quiet: true });
        } finally {
            setQuickSaving(false);
        }
    }

    async function updateToggle<K extends "enabled" | "promptForMissingImages" | "showStarRatings">(
        key: K,
        value: QueueSettings[K]
    ) {
        if (key === "enabled") {
            setEnabled(Boolean(value));
        } else if (key === "promptForMissingImages") {
            setPromptForMissingImages(Boolean(value));
        } else {
            setShowStarRatings(Boolean(value));
        }

        await saveSettingsImmediately({
            ...settings,
            enabled: key === "enabled" ? Boolean(value) : enabled,
            delayDays,
            promptForMissingImages: key === "promptForMissingImages" ? Boolean(value) : promptForMissingImages,
            showStarRatings: key === "showStarRatings" ? Boolean(value) : showStarRatings,
            starRatingCurve: settings.starRatingCurve
        });
    }

    async function updateCategoryCurveEnabled(isEnabled: boolean) {
        setUseCategoryStarCurve(isEnabled);
        if (!selectedCategory) {
            return;
        }

        if (!isEnabled) {
            await onSaveCategoryStarRatingCurve(selectedCategory.id, null, { quiet: true });
            return;
        }

        try {
            await onSaveCategoryStarRatingCurve(
                selectedCategory.id,
                parseStarRatingCurveText(categoryStarCurveText),
                { quiet: true }
            );
            setCategoryStarCurveError(null);
        } catch (error) {
            setCategoryStarCurveError(errorMessage(error));
        }
    }

    function applyCurveBuilder(target: "global" | "category") {
        const builder = target === "global" ? globalCurveBuilder : categoryCurveBuilder;
        const text = starRatingCurveToText(generateNormalStarRatingCurve(builder));
        if (target === "global") {
            setStarCurveText(text);
            setStarCurveError(null);
        } else {
            setCategoryStarCurveText(text);
            setCategoryStarCurveError(null);
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        let starRatingCurve: QueueSettings["starRatingCurve"];
        if (showStarRatings) {
            try {
                starRatingCurve = parseStarRatingCurveText(starCurveText);
            } catch (error) {
                setStarCurveError(errorMessage(error));
                return;
            }
        } else {
            starRatingCurve = settings.starRatingCurve;
        }

        let categoryStarRatingCurve: QueueSettings["starRatingCurve"] | null = null;
        if (selectedCategory && showStarRatings && useCategoryStarCurve) {
            try {
                categoryStarRatingCurve = parseStarRatingCurveText(categoryStarCurveText);
            } catch (error) {
                setCategoryStarCurveError(errorMessage(error));
                return;
            }
        }

        await onSaveSettings({
            enabled,
            delayDays,
            promptForMissingImages,
            showStarRatings,
            starRatingCurve
        });
        if (selectedCategory) {
            await onSaveCategoryStarRatingCurve(selectedCategory.id, categoryStarRatingCurve);
        }
        setMenuOpen(false);
    }

    return (
        <div className="account-menu" ref={menuRef}>
            <button
                aria-expanded={menuOpen}
                className="account-menu-toggle"
                ref={floatingMenu.triggerRef}
                type="button"
                onClick={() => {
                    if (!menuOpen) {
                        setActivePanel(null);
                    }
                    setMenuOpen((isOpen) => !isOpen);
                }}
            >
                <span className="account-avatar" aria-hidden="true" />
            </button>

            {menuOpen ? (
                <div
                    className="stack account-menu-panel floating-menu-panel"
                    ref={floatingMenu.panelRef}
                    style={floatingMenu.style}
                >
                    {activePanel === "settings" ? (
                        <>
                            <div className="account-menu-header">
                                <button className="small-button" type="button" onClick={() => setActivePanel(null)}>
                                    Back
                                </button>
                                <strong>Settings</strong>
                            </div>
                            <form className="stack account-subpanel" onSubmit={handleSubmit}>
                                <label className="checkbox-row">
                                    <input
                                        checked={enabled}
                                        disabled={busy || quickSaving}
                                        type="checkbox"
                                        onChange={(event) => void updateToggle("enabled", event.target.checked)}
                                    />
                                    <span>Queue new entries</span>
                                </label>
                                <label className="checkbox-row">
                                    <input
                                        checked={promptForMissingImages}
                                        disabled={busy || quickSaving}
                                        type="checkbox"
                                        onChange={(event) => void updateToggle("promptForMissingImages", event.target.checked)}
                                    />
                                    <span>Prompt for missing images</span>
                                </label>
                                <label className="checkbox-row">
                                    <input
                                        checked={showStarRatings}
                                        disabled={busy || quickSaving}
                                        type="checkbox"
                                        onChange={(event) => void updateToggle("showStarRatings", event.target.checked)}
                                    />
                                    <span>Show star ratings</span>
                                </label>
                                <label className="stack compact-stack">
                                    <span className="muted">Queue delay (days)</span>
                                    <input
                                        disabled={busy}
                                        min={0}
                                        max={365}
                                        type="number"
                                        value={delayDays}
                                        onChange={(event) => setDelayDays(Number(event.target.value))}
                                    />
                                </label>
                                {showStarRatings ? (
                                    <details className="stack compact-stack star-curve-editor">
                                        <summary>Global star curve</summary>
                                        <StarCurveBuilder
                                            disabled={busy}
                                            value={globalCurveBuilder}
                                            onApply={() => applyCurveBuilder("global")}
                                            onChange={setGlobalCurveBuilder}
                                        />
                                        <textarea
                                            aria-label="Global star curve"
                                            disabled={busy}
                                            rows={9}
                                            spellCheck={false}
                                            value={starCurveText}
                                            onChange={(event) => {
                                                setStarCurveText(event.target.value);
                                                setStarCurveError(null);
                                            }}
                                        />
                                        {starCurveError ? <div className="status">{starCurveError}</div> : null}
                                        <button
                                            className="small-button"
                                            disabled={busy}
                                            type="button"
                                            onClick={() => {
                                                setStarCurveText(starRatingCurveToText(DEFAULT_STAR_RATING_CURVE));
                                                setStarCurveError(null);
                                            }}
                                        >
                                            Reset Curve
                                        </button>
                                    </details>
                                ) : null}
                                {showStarRatings && selectedCategory ? (
                                    <details className="stack compact-stack star-curve-editor">
                                        <summary>{selectedCategory.name} star curve</summary>
                                        <label className="checkbox-row">
                                            <input
                                                checked={useCategoryStarCurve}
                                                disabled={busy || quickSaving}
                                                type="checkbox"
                                                onChange={(event) => void updateCategoryCurveEnabled(event.target.checked)}
                                            />
                                            <span>Use custom curve for this category</span>
                                        </label>
                                        {useCategoryStarCurve ? (
                                            <>
                                                <StarCurveBuilder
                                                    disabled={busy}
                                                    value={categoryCurveBuilder}
                                                    onApply={() => applyCurveBuilder("category")}
                                                    onChange={setCategoryCurveBuilder}
                                                />
                                                <textarea
                                                    aria-label={`${selectedCategory.name} star curve`}
                                                    disabled={busy}
                                                    rows={9}
                                                    spellCheck={false}
                                                    value={categoryStarCurveText}
                                                    onChange={(event) => {
                                                        setCategoryStarCurveText(event.target.value);
                                                        setCategoryStarCurveError(null);
                                                    }}
                                                />
                                                {categoryStarCurveError ? <div className="status">{categoryStarCurveError}</div> : null}
                                                <button
                                                    className="small-button"
                                                    disabled={busy}
                                                    type="button"
                                                    onClick={() => {
                                                        setCategoryStarCurveText(starRatingCurveToText(settings.starRatingCurve));
                                                        setCategoryStarCurveError(null);
                                                    }}
                                                >
                                                    Use Global Curve Text
                                                </button>
                                            </>
                                        ) : null}
                                    </details>
                                ) : null}
                                <button disabled={busy} type="submit">Save Settings</button>
                            </form>
                        </>
                    ) : activePanel === "import" ? (
                        <>
                            <div className="account-menu-header">
                                <button className="small-button" type="button" onClick={() => setActivePanel(null)}>
                                    Back
                                </button>
                                <strong>Import Spreadsheet</strong>
                            </div>
                            <form className="stack account-subpanel" onSubmit={handleImportSubmit}>
                                <input disabled={importDisabled} name="firstConsumedAt" type="date" />
                                <input disabled={importDisabled} name="workbook" type="file" accept=".xlsx" />
                                <button disabled={importDisabled} type="submit">
                                    {busyLabel?.startsWith("Import") ? "Importing..." : "Import"}
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="account-menu-header">
                                <span className="account-avatar large" aria-hidden="true" />
                                <div>
                                    <strong>{userName}</strong>
                                </div>
                            </div>
                            <button type="button" onClick={() => setActivePanel("settings")}>
                                Settings
                            </button>
                            <button
                                type="button"
                                onClick={() => onThemeChange(themeMode === "dark" ? "light" : "dark")}
                            >
                                Switch to {themeMode === "dark" ? "Light" : "Dark"} Mode
                            </button>
                            <button
                                disabled={importDisabled}
                                type="button"
                                onClick={() => setActivePanel("import")}
                            >
                                Import xlsx
                            </button>
                            <button disabled={busy} type="button" onClick={() => void handleExportClick()}>
                                Export xlsx
                            </button>
                            <button
                                className="danger menu-danger"
                                type="button"
                                onClick={() => signOut().then(() => window.location.assign("/"))}
                            >
                                Sign Out
                            </button>
                        </>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function StarCurveBuilder({
    disabled,
    onApply,
    onChange,
    value
}: {
    disabled: boolean;
    onApply: () => void;
    onChange: (value: StarCurveBuilderState) => void;
    value: StarCurveBuilderState;
}) {
    function update<K extends keyof StarCurveBuilderState>(key: K, nextValue: number) {
        onChange({ ...value, [key]: nextValue });
    }

    return (
        <div className="star-curve-builder">
            <label>
                <span className="muted">Max stars</span>
                <input
                    disabled={disabled}
                    min={1}
                    max={100}
                    step={0.5}
                    type="number"
                    value={value.maxStars}
                    onChange={(event) => update("maxStars", Number(event.target.value))}
                />
            </label>
            <label>
                <span className="muted">Average item</span>
                <input
                    disabled={disabled}
                    min={0}
                    max={value.maxStars}
                    step={0.1}
                    type="number"
                    value={value.averageStars}
                    onChange={(event) => update("averageStars", Number(event.target.value))}
                />
            </label>
            <label>
                <span className="muted">Within ±1</span>
                <input
                    disabled={disabled}
                    min={5}
                    max={98}
                    step={1}
                    type="number"
                    value={value.withinOneStarPercent}
                    onChange={(event) => update("withinOneStarPercent", Number(event.target.value))}
                />
            </label>
            <button className="small-button" disabled={disabled} type="button" onClick={onApply}>
                Generate Curve
            </button>
        </div>
    );
}

function QueuePanel({
    activeSessionId,
    busy,
    queueRankMode,
    queuedEntries,
    onDelete,
    onPickImage,
    onRename,
    onStart,
    onStartQueue,
    onStopQueue
}: {
    activeSessionId: string | null;
    busy: boolean;
    queueRankMode: boolean;
    queuedEntries: QueuedEntry[];
    onDelete: (entry: QueuedEntry) => Promise<void>;
    onPickImage: (entry: QueuedEntry) => void;
    onRename: (entry: QueuedEntry, name: string) => Promise<void>;
    onStart: (entry: QueuedEntry) => Promise<void>;
    onStartQueue: () => Promise<void>;
    onStopQueue: () => void;
}) {
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const readyEntries = queuedEntries.filter((entry) => entry.availableAt <= currentTime);
    const pendingEntries = queuedEntries.filter((entry) => entry.availableAt > currentTime);

    return (
        <section className="stack panel queue-panel">
            <div className="toolbar queue-toolbar">
                <strong>Queue</strong>
                <div className="queue-summary">
                    <span className="metric">{queuedEntries.length} queued</span>
                    <span className="metric">{readyEntries.length} ready</span>
                </div>
            </div>
            <div className="queue-rank-actions">
                <button
                    className={queueRankMode ? undefined : "primary"}
                    disabled={queueRankMode ? false : busy || Boolean(activeSessionId) || readyEntries.length === 0}
                    type="button"
                    onClick={() => {
                        if (queueRankMode) {
                            onStopQueue();
                        } else {
                            void onStartQueue();
                        }
                    }}
                >
                    {queueRankMode ? "Stop Ranking Queue" : "Rank Queue"}
                </button>
            </div>

            {queuedEntries.length > 0 ? (
                <div className="queue-list">
                    {readyEntries.map((entry) => (
                        <QueuedEntryRow
                            disabled={busy || Boolean(activeSessionId)}
                            entry={entry}
                            isReady
                            key={entry.id}
                            onDelete={onDelete}
                            onPickImage={onPickImage}
                            onRename={onRename}
                            onStart={onStart}
                        />
                    ))}
                    {pendingEntries.map((entry) => (
                        <QueuedEntryRow
                            disabled={busy || Boolean(activeSessionId)}
                            entry={entry}
                            isReady={false}
                            key={entry.id}
                            onDelete={onDelete}
                            onPickImage={onPickImage}
                            onRename={onRename}
                            onStart={onStart}
                        />
                    ))}
                </div>
            ) : (
                <div className="muted">No queued entries.</div>
            )}
        </section>
    );
}

function QueuedEntryRow({
    disabled,
    entry,
    isReady,
    onDelete,
    onPickImage,
    onRename,
    onStart
}: {
    disabled: boolean;
    entry: QueuedEntry;
    isReady: boolean;
    onDelete: (entry: QueuedEntry) => Promise<void>;
    onPickImage: (entry: QueuedEntry) => void;
    onRename: (entry: QueuedEntry, name: string) => Promise<void>;
    onStart: (entry: QueuedEntry) => Promise<void>;
}) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [name, setName] = useState(entry.name);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen);

    useEffect(() => {
        setName(entry.name);
        setIsRenaming(false);
        setMenuOpen(false);
    }, [entry.name]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(entry, name);
        setIsRenaming(false);
    }

    return (
        <div className={`queue-item ${isReady ? "ready" : ""}`}>
            <QueuedPoster entry={entry} />
            <div className="queue-item-body">
                {isRenaming ? (
                    <form className="queue-rename-form" onSubmit={handleSubmit}>
                        <input
                            autoFocus
                            disabled={disabled}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <div className="queue-rename-actions">
                            <button disabled={disabled} type="submit">Save</button>
                            <button
                                disabled={disabled}
                                type="button"
                                onClick={() => {
                                    setName(entry.name);
                                    setIsRenaming(false);
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <div>
                        <strong>{entry.name}</strong>
                        <p className="muted">{entry.categoryName} · {isReady ? "Ready" : formatDateTime(entry.availableAt)}</p>
                    </div>
                )}
                <div className="queue-actions">
                    <button disabled={disabled} type="button" onClick={() => void onStart(entry)}>
                        Rank Now
                    </button>
                    <button
                        className="queue-image-button"
                        disabled={disabled}
                        type="button"
                        onClick={() => onPickImage(entry)}
                    >
                        {hasStoredImage(entry.imageKey) ? "Change Image" : "Pick Image"}
                    </button>
                    <div className="queue-menu" ref={menuRef}>
                        <button
                            aria-expanded={menuOpen}
                            aria-label={`More actions for ${entry.name}`}
                            className="queue-menu-button"
                            disabled={disabled}
                            ref={floatingMenu.triggerRef}
                            type="button"
                            onClick={() => setMenuOpen((isOpen) => !isOpen)}
                        >
                            ...
                        </button>
                        {menuOpen ? (
                            <div
                                className="queue-overflow-panel floating-menu-panel"
                                ref={floatingMenu.panelRef}
                                style={floatingMenu.style}
                            >
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        setIsRenaming(true);
                                    }}
                                >
                                    Rename
                                </button>
                                <button
                                    className="danger menu-danger"
                                    type="button"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        void onDelete(entry);
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function QueuedPoster({ entry }: { entry: QueuedEntry }) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    if (hasStoredImage(entry.imageKey) && !imageFailed) {
        return (
            <img
                className="queue-poster"
                src={`/api/queued-images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className="queue-poster image-placeholder">
            <span>{entry.name}</span>
            {isNoImageKey(entry.imageKey) ? <small>No image</small> : null}
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
    const defaultQuery = `${target.item.name} (${target.category.name})`;
    const [query, setQuery] = useState(defaultQuery);
    const [candidates, setCandidates] = useState<ImageSearchCandidate[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const candidatesRef = useRef<ImageSearchCandidate[]>([]);
    const candidatesByQueryRef = useRef<Map<string, ImageSearchCandidate[]>>(new Map());
    const thumbnailPosterBlobsRef = useRef<Map<string, Blob>>(new Map());
    const displayedQueryRef = useRef<string | null>(null);
    const searchRequestIdRef = useRef(0);
    const activeSearchControllerRef = useRef<AbortController | null>(null);
    useEscapeKey(true, onClose);

    function interruptSearch() {
        searchRequestIdRef.current += 1;
        activeSearchControllerRef.current?.abort();
        activeSearchControllerRef.current = null;
        setLoading(false);
    }

    const search = useCallback(async (searchQuery: string) => {
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        const submittedQuery = searchQuery.trim();
        if (!submittedQuery) {
            setLoading(false);
            setError("Search query is required.");
            return;
        }

        const cachedCandidates = candidatesByQueryRef.current.get(submittedQuery.toLowerCase());
        if (cachedCandidates && cachedCandidates.length > 0) {
            candidatesRef.current = cachedCandidates;
            thumbnailPosterBlobsRef.current.clear();
            displayedQueryRef.current = submittedQuery;
            setCandidates(cachedCandidates);
            setError(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        const cacheBust = crypto.randomUUID();
        activeSearchControllerRef.current?.abort();
        const controller = new AbortController();
        activeSearchControllerRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_SEARCH_TIMEOUT_MS);

        try {
            const url = new URL("/api/image-search", window.location.origin);
            url.searchParams.set(target.kind === "entry" ? "entryId" : "queuedEntryId", target.item.id);
            url.searchParams.set("query", submittedQuery);
            url.searchParams.set("refresh", cacheBust);
            const response = await fetch(url, {
                cache: "no-store",
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({})) as {
                candidates?: ImageSearchCandidate[];
                message?: string;
            };

            if (!response.ok) {
                throw new Error(body.message ?? "Image search failed");
            }

            if (requestId !== searchRequestIdRef.current) {
                return;
            }

            const candidates = Array.isArray(body.candidates) ? body.candidates : [];
            const nextCandidates = candidates.map((candidate) => ({
                ...candidate,
                imageUrl: withCacheBust(candidate.imageUrl, cacheBust),
                thumbnailUrl: withCacheBust(candidate.thumbnailUrl, cacheBust)
            }));
            if (nextCandidates.length === 0) {
                throw new Error("No image candidates found");
            }

            candidatesRef.current = nextCandidates;
            candidatesByQueryRef.current.set(submittedQuery.toLowerCase(), nextCandidates);
            thumbnailPosterBlobsRef.current.clear();
            displayedQueryRef.current = submittedQuery;
            setCandidates(nextCandidates);
        } catch (searchError) {
            if (requestId !== searchRequestIdRef.current) {
                return;
            }

            if (candidatesRef.current.length > 0) {
                setCandidates(candidatesRef.current);
                const previousQuery = displayedQueryRef.current
                    ? ` for "${displayedQueryRef.current}"`
                    : "";
                setError(`${errorMessage(searchError)}. Showing previous results${previousQuery}.`);
            } else {
                setCandidates([]);
                setError(errorMessage(searchError));
            }
        } finally {
            window.clearTimeout(timeoutId);
            if (requestId === searchRequestIdRef.current) {
                if (activeSearchControllerRef.current === controller) {
                    activeSearchControllerRef.current = null;
                }
                setLoading(false);
            }
        }
    }, [target.kind, target.item.id]);

    useEffect(() => {
        setQuery(defaultQuery);
        candidatesRef.current = [];
        candidatesByQueryRef.current.clear();
        thumbnailPosterBlobsRef.current.clear();
        displayedQueryRef.current = null;
        setCandidates([]);
        void search(defaultQuery);
    }, [defaultQuery, search]);

    useEffect(() => () => {
        searchRequestIdRef.current += 1;
        activeSearchControllerRef.current?.abort();
    }, []);

    async function selectCandidate(
        candidate: ImageSearchCandidate,
        renderedThumbnail: HTMLImageElement | null
    ) {
        setSavingCandidateId(candidate.id);
        setError(null);

        try {
            const blob = await imageCandidateToPosterBlob(
                candidate,
                renderedThumbnail,
                thumbnailPosterBlobsRef.current.get(candidate.id) ?? null
            );
            await uploadImageForTarget(target, blob);
            await onSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    function cacheRenderedThumbnail(candidate: ImageSearchCandidate, image: HTMLImageElement) {
        void imageElementToPosterBlob(image)
            .then((blob) => {
                thumbnailPosterBlobsRef.current.set(candidate.id, blob);
            })
            .catch(() => {
                thumbnailPosterBlobsRef.current.delete(candidate.id);
            });
    }

    async function uploadLocalFile(file: File) {
        interruptSearch();
        setSavingCandidateId("local");
        setError(null);

        try {
            const objectUrl = URL.createObjectURL(file);
            try {
                const blob = await imageUrlToPosterBlob(objectUrl);
                await uploadImageForTarget(target, blob);
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

    async function saveNoImage() {
        interruptSearch();
        setSavingCandidateId("none");
        setError(null);

        try {
            await markImageUnavailable({
                data: {
                    targetKind: target.kind,
                    targetId: target.item.id
                }
            });
            await onSaved();
        } catch (saveError) {
            setError(errorMessage(saveError));
        } finally {
            setSavingCandidateId(null);
        }
    }

    return (
        <div
            className="modal-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section className="image-picker-modal">
                <div className="toolbar">
                    <div>
                        <h2>Pick Image</h2>
                        <p className="muted">{target.item.name} - {target.category.name}</p>
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
                        onChange={(event) => {
                            setQuery(event.target.value);
                            if (error) {
                                setError(null);
                            }
                        }}
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

                <div className="image-picker-actions">
                    <label className="file-button">
                        <span>Upload File</span>
                        <input
                            accept="image/*"
                            disabled={Boolean(savingCandidateId)}
                            type="file"
                            onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) {
                                    void uploadLocalFile(file);
                                }
                            }}
                        />
                    </label>
                    <button
                        disabled={Boolean(savingCandidateId)}
                        type="button"
                        onClick={() => void saveNoImage()}
                    >
                        {savingCandidateId === "none" ? "Saving..." : "Use No Image"}
                    </button>
                </div>

                {error ? <div className="status">{error}</div> : null}
                {loading ? <div className="status">Searching for images...</div> : null}

                <div className="image-picker-grid">
                    {candidates.map((candidate) => (
                        <button
                            className="image-candidate"
                            disabled={Boolean(savingCandidateId)}
                            key={candidate.id}
                            type="button"
                            onClick={(event) => {
                                const renderedThumbnail = event.currentTarget.querySelector("img");
                                void selectCandidate(candidate, renderedThumbnail);
                            }}
                        >
                            <img
                                alt=""
                                src={candidate.thumbnailUrl}
                                loading="lazy"
                                decoding="async"
                                onLoad={(event) => cacheRenderedThumbnail(candidate, event.currentTarget)}
                            />
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
    categories,
    canMoveDown,
    canMoveUp,
    listLocked,
    selectedCategoryId,
    starRating,
    starRatingScale,
    onDelete,
    onMoveDown,
    onMoveUp,
    onPickImage,
    onRename,
    onRerank,
    onSwitch
}: {
    entry: Entry;
    categories: CategoryWithEntries[];
    canMoveDown: boolean;
    canMoveUp: boolean;
    listLocked: boolean;
    selectedCategoryId: string;
    starRating: number | null;
    starRatingScale: number;
    onDelete: () => void;
    onMoveDown: () => void;
    onMoveUp: () => void;
    onPickImage: () => void;
    onRename: (name: string) => Promise<void>;
    onRerank: () => void;
    onSwitch: (targetCategoryId: string) => void;
}) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(entry.name);
    const [targetCategoryId, setTargetCategoryId] = useState(selectedCategoryId);
    const [menuOpen, setMenuOpen] = useState(false);
    const [moveControlsOpen, setMoveControlsOpen] = useState(false);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen);

    useEffect(() => {
        setIsRenaming(false);
        setRenameValue(entry.name);
        setTargetCategoryId(selectedCategoryId);
        setMenuOpen(false);
        setMoveControlsOpen(false);
    }, [entry.name, selectedCategoryId]);

    async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(renameValue);
        setIsRenaming(false);
    }

    return (
        <article className="entry-card">
            <EntryPoster entry={entry} starRating={starRating} starRatingScale={starRatingScale} />
            <div className="entry-card-body">
                {isRenaming ? (
                    <form className="entry-rename-form" onSubmit={handleRenameSubmit}>
                        <span className="muted">#{entry.rankPosition + 1}</span>
                        <input
                            autoFocus
                            aria-label={`Rename ${entry.name}`}
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                        />
                        <div className="entry-rename-actions">
                            <button type="submit">Save</button>
                            <button
                                type="button"
                                onClick={() => {
                                    setRenameValue(entry.name);
                                    setIsRenaming(false);
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <strong className="entry-title" title={`#${entry.rankPosition + 1} ${entry.name}`}>
                        #{entry.rankPosition + 1} {entry.name}
                    </strong>
                )}
                {entry.firstConsumedAt ? (
                    <div className="metric-row">
                        <span className="metric">{formatDate(entry.firstConsumedAt)}</span>
                    </div>
                ) : null}
                <div className="entry-actions card-actions">
                    <button disabled={listLocked} type="button" onClick={onRerank}>Rerank</button>
                    <div className="rank-step-group">
                        <button
                            aria-label={`Move ${entry.name} up one spot`}
                            className="rank-step-button"
                            disabled={listLocked || !canMoveUp}
                            type="button"
                            onClick={onMoveUp}
                        >
                            ↑
                        </button>
                        <button
                            aria-label={`Move ${entry.name} down one spot`}
                            className="rank-step-button"
                            disabled={listLocked || !canMoveDown}
                            type="button"
                            onClick={onMoveDown}
                        >
                            ↓
                        </button>
                    </div>
                    <button type="button" onClick={onPickImage}>
                        {hasStoredImage(entry.imageKey) ? "Change Image" : "Pick Image"}
                    </button>
                    <div className="entry-menu" ref={menuRef}>
                        <button
                            aria-expanded={menuOpen}
                            aria-label={`More actions for ${entry.name}`}
                            className="entry-menu-button"
                            ref={floatingMenu.triggerRef}
                            type="button"
                            onClick={() => setMenuOpen((isOpen) => !isOpen)}
                        >
                            ...
                        </button>
                        {menuOpen ? (
                            <div
                                className="entry-overflow-panel floating-menu-panel"
                                ref={floatingMenu.panelRef}
                                style={floatingMenu.style}
                            >
                                <button
                                    disabled={listLocked}
                                    type="button"
                                    onClick={() => {
                                        setMoveControlsOpen(false);
                                        setMenuOpen(false);
                                        setIsRenaming(true);
                                    }}
                                >
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMoveControlsOpen(true);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Change Category
                                </button>
                                <button
                                    className="danger menu-danger"
                                    disabled={listLocked}
                                    type="button"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        onDelete();
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
                {moveControlsOpen ? (
                    <div className="entry-move-panel">
                        <strong>Change Category</strong>
                        <div className="entry-actions stacked-action">
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
                            <div className="entry-actions two-buttons">
                                <button
                                    type="button"
                                    onClick={() => setMoveControlsOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    disabled={listLocked || targetCategoryId === selectedCategoryId}
                                    type="button"
                                    onClick={() => onSwitch(targetCategoryId)}
                                >
                                    Move
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function EntryPoster({
    entry,
    starRating,
    starRatingScale
}: {
    entry: Entry;
    starRating: number | null;
    starRatingScale: number;
}) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    return (
        <div className="entry-poster-frame">
            {hasStoredImage(entry.imageKey) && !imageFailed ? (
                <img
                    className="entry-poster"
                    src={`/api/images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <div className="entry-poster image-placeholder">
                    <span>{entry.name}</span>
                    <small>{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
                </div>
            )}
            {starRating !== null ? (
                <span
                    className="entry-star-badge"
                    aria-label={`Star rating ${formatRatingNumber(starRating)} out of ${formatRatingNumber(starRatingScale)}`}
                >
                    <span aria-hidden="true" className="star-symbol">★</span>
                    {formatRatingNumber(starRating)}/{formatRatingNumber(starRatingScale)}
                </span>
            ) : null}
        </div>
    );
}

function RandomAuditPanel({
    pair,
    onCancel,
    onChoose,
    onNeedImage
}: {
    pair: RandomAuditPair;
    onCancel: () => void;
    onChoose: (winnerId: string) => void;
    onNeedImage: (entry: Entry, category: Pick<CategoryWithEntries, "id" | "name">) => void;
}) {
    useEffect(() => {
        const missingImageEntry = shouldPromptForImage(pair.leftEntry.imageKey)
            ? pair.leftEntry
            : shouldPromptForImage(pair.rightEntry.imageKey)
                ? pair.rightEntry
                : null;

        if (missingImageEntry) {
            onNeedImage(missingImageEntry, {
                id: pair.categoryId,
                name: pair.categoryName
            });
        }
    }, [onNeedImage, pair]);

    return (
        <section className="rank-panel stack">
            <div className="toolbar">
                <div>
                    <strong>Random Audit · {pair.categoryName}</strong>
                    <p className="muted rank-meta">Pick the entry you prefer. If this catches an ordering issue, the repair will stay cancellable until it is finished.</p>
                </div>
                <button className="small-button" type="button" onClick={onCancel}>
                    Cancel Audit
                </button>
            </div>
            <div className="match-grid">
                <button
                    className="match-choice"
                    type="button"
                    onClick={() => onChoose(pair.leftEntry.id)}
                >
                    <MatchPoster entry={pair.leftEntry} />
                    <strong>{pair.leftEntry.name}</strong>
                </button>
                <button
                    className="match-choice"
                    type="button"
                    onClick={() => onChoose(pair.rightEntry.id)}
                >
                    <MatchPoster entry={pair.rightEntry} />
                    <strong>{pair.rightEntry.name}</strong>
                </button>
            </div>
        </section>
    );
}

function BinaryRankPanel({
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
                if (isCurrent) {
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
            setError(errorMessage(submitError));
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
            setError(errorMessage(cancelError));
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
                        {session.operationKind === "random_audit"
                            ? "Audit Repair"
                            : session.phase === "local_repair"
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
                        {session.operationKind === "random_audit"
                            ? "Cancel Audit"
                            : session.source === "rerank_entry"
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

function formatRatingNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function curveBuilderDefaults(curve: QueueSettings["starRatingCurve"]): StarCurveBuilderState {
    return {
        minStars: 1,
        maxStars: starRatingScaleMax(curve),
        averageStars: starRatingForPercentile(0.5, curve),
        withinOneStarPercent: 75
    };
}

function formatDateTime(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(timestamp));
}

function withCacheBust(path: string, value: string) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("refresh", value);
    return `${url.pathname}${url.search}`;
}

function errorMessage(error: unknown) {
    if (
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError"
    ) {
        return "Image search timed out";
    }

    return error instanceof Error ? error.message : String(error);
}

async function imageUrlToPosterBlob(imageUrl: string) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error("Remote image could not be loaded");
    }

    return imageBlobToPosterBlob(await response.blob());
}

async function imageCandidateToPosterBlob(
    candidate: ImageSearchCandidate,
    renderedThumbnail: HTMLImageElement | null,
    cachedThumbnailBlob: Blob | null
) {
    try {
        return await imageUrlToPosterBlob(candidate.imageUrl);
    } catch (fullSizeError) {
        if (cachedThumbnailBlob) {
            return cachedThumbnailBlob;
        }

        if (
            renderedThumbnail?.complete &&
            renderedThumbnail.naturalWidth > 0 &&
            renderedThumbnail.naturalHeight > 0
        ) {
            try {
                return await imageElementToPosterBlob(renderedThumbnail);
            } catch {
                // Fall through to a network thumbnail fetch as the last resort.
            }
        }

        if (candidate.thumbnailUrl === candidate.imageUrl) {
            throw new Error("Displayed image could not be saved");
        }

        return imageUrlToPosterBlob(candidate.thumbnailUrl);
    }
}

function imageBlobToPosterBlob(blob: Blob) {
    if (blob.size > MAX_LOCAL_IMAGE_BYTES) {
        throw new Error("Image file is too large");
    }

    return new Promise<Blob>((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);

        image.onload = () => {
            imageElementToPosterBlob(image)
                .then(resolve)
                .catch(reject)
                .finally(() => URL.revokeObjectURL(objectUrl));
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Full-size image could not be loaded"));
        };
        image.src = objectUrl;
    });
}

function imageElementToPosterBlob(image: HTMLImageElement) {
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
        }
    });
}

async function uploadImageForTarget(target: ImagePickerTarget, blob: Blob) {
    const endpoint = target.kind === "entry"
        ? `/api/images/${encodeURIComponent(target.item.id)}`
        : `/api/queued-images/${encodeURIComponent(target.item.id)}`;
    const response = await fetch(endpoint, {
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
