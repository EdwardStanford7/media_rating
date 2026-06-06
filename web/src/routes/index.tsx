import { Link, createFileRoute } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, CSSProperties, DragEvent, FormEvent, ReactNode } from "react";
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
    moveCategoryRelativeToCategory,
    moveEntryRelativeToEntry,
    renameCategory,
    renameEntry,
    renameQueuedEntry,
    restoreEntry,
    restoreQueuedEntry,
    startRerankEntry,
    startQueuedEntryRanking,
    submitBinaryWinner,
    switchEntryCategory,
    updateQueueSettings
} from "@/lib/server/actions";
import { signIn, signOut, signUp } from "@/lib/auth-client";
import { hasStoredImage, isNoImageKey, shouldPromptForImage } from "@/lib/images";
import { orderEntries } from "@/lib/ranking";
import { applyThemeMode, readInitialThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";
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

type DropPlacement = "before" | "after";

interface EntryDragPreview {
    draggedEntryId: string;
    targetEntryId: string;
    placement: DropPlacement;
}

interface CategoryDragPreview {
    draggedCategoryId: string;
    targetCategoryId: string;
    placement: DropPlacement;
}

type IconName =
    | "cancel"
    | "category"
    | "close"
    | "delete"
    | "down"
    | "edit"
    | "export"
    | "image"
    | "import"
    | "move"
    | "rank"
    | "rerank"
    | "reset"
    | "search"
    | "settings"
    | "undo"
    | "up";

interface AppToast {
    id: number;
    message: string;
    variant?: "default" | "success" | "danger";
    actionLabel?: string;
    onAction?: () => Promise<void> | void;
}

interface ReversibleAction {
    id: number;
    undoToastMessage: string;
    redoToastMessage: string;
    variant?: AppToast["variant"];
    undo: () => Promise<void>;
    redo: () => Promise<void>;
}

const POSTER_WIDTH = 380;
const POSTER_HEIGHT = 475;
const MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_SEARCH_TIMEOUT_MS = 15_000;
const TOAST_TIMEOUT_MS = 7000;
const UNDO_STACK_LIMIT = 20;
const ICONS: Record<IconName, string> = {
    cancel: "×",
    category: "⇄",
    close: "×",
    delete: "⌫",
    down: "↓",
    edit: "✎",
    export: "⇡",
    image: "▣",
    import: "⇣",
    move: "⇄",
    rank: "▶",
    rerank: "↻",
    reset: "↺",
    search: "⌕",
    settings: "⚙",
    undo: "↶",
    up: "↑"
};
type AuthMode = "signin" | "signup" | "reset-request";

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

    if (!session?.user || !dashboard) {
        return <AuthPage authOptions={authOptions} />;
    }

    return (
        <Dashboard
            initialDashboard={dashboard}
            userImage={session.user.image ?? null}
            userName={session.user.name}
        />
    );
}

function AuthPage({
    authOptions
}: {
    authOptions: {
        minPasswordLength: number;
    };
}) {
    const [authMode, setAuthMode] = useState<AuthMode>("signin");
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [resetToken, setResetToken] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

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
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const name = String(form.get("name") ?? email);

        try {
            if (mode === "signup") {
                if (password.length < authOptions.minPasswordLength) {
                    setError(passwordLengthMessage(authOptions.minPasswordLength));
                    return;
                }
                await signUpWithEmail({ email, password, name });
            } else {
                await signInWithEmail({ email, password });
            }
            window.location.assign("/");
        } catch (authError) {
            setError(formatAuthError(authError, mode, authOptions.minPasswordLength));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRequestPasswordReset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setStatusMessage(null);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");

        try {
            await requestPasswordResetEmail({ email });
            setStatusMessage("If that email exists, check your inbox for a reset link.");
        } catch (authError) {
            const message = authError instanceof Error ? authError.message.toLowerCase() : "";
            if (message.includes("too many") || message.includes("rate")) {
                setError("Too many attempts. Try again later.");
            } else {
                setStatusMessage("If that email exists, check your inbox for a reset link.");
            }
        } finally {
            setSubmitting(false);
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
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const newPassword = String(form.get("newPassword") ?? "");
        const confirmPassword = String(form.get("confirmPassword") ?? "");
        if (newPassword.length < authOptions.minPasswordLength) {
            setError(passwordLengthMessage(authOptions.minPasswordLength));
            setSubmitting(false);
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            setSubmitting(false);
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
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="auth-page">
            <div className="auth-shell">
                <section className="auth-hero" aria-label="goldshelf">
                    <h1>Goldshelf</h1>
                    <p>Rank your taste, one choice at a time.</p>
                </section>

                <section className="auth-panel" aria-labelledby="auth-heading">
                    <div className="auth-copy">
                        <p className="auth-kicker">
                            {resetToken
                                ? "Account Recovery"
                                : authMode === "signin"
                                    ? "Welcome Back"
                                    : authMode === "reset-request"
                                        ? "Account Recovery"
                                        : "Welcome to goldshelf"}
                        </p>
                        <h2 id="auth-heading">
                            {resetToken
                                ? "Reset password"
                                : authMode === "signin"
                                    ? "Sign in"
                                    : authMode === "reset-request"
                                        ? "Reset password"
                                        : "Create account"}
                        </h2>
                        <p className="muted">
                            {resetToken
                                ? "Choose a new password to get back to your lists."
                                : authMode === "signin"
                                    ? "Pick up where your rankings left off."
                                    : authMode === "reset-request"
                                        ? "Enter your email and we will send a reset link."
                                        : "Start building rankings that actually reflect your taste."}
                        </p>
                    </div>

                    {error ? <div className="status">{error}</div> : null}
                    {statusMessage ? <div className="status">{statusMessage}</div> : null}

                    {resetToken ? (
                        <form className="auth-form" onSubmit={handleResetPassword}>
                            <PasswordField
                                label="New password"
                                name="newPassword"
                                placeholder="New password"
                                autoComplete="new-password"
                            />
                            <PasswordField
                                label="Confirm password"
                                name="confirmPassword"
                                placeholder="Confirm new password"
                                autoComplete="new-password"
                            />
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting ? "Updating..." : "Update password"}
                            </button>
                        </form>
                    ) : authMode === "reset-request" ? (
                        <form className="auth-form" onSubmit={handleRequestPasswordReset}>
                            <label className="auth-field">
                                <span>Email</span>
                                <input name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
                            </label>
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting ? "Sending..." : "Send reset link"}
                            </button>
                        </form>
                    ) : (
                        <form className="auth-form" onSubmit={(event) => handleEmailAuth(event, authMode)}>
                            {authMode === "signup" ? (
                                <label className="auth-field">
                                    <span>Name</span>
                                    <input name="name" placeholder="Jane Doe" autoComplete="name" required />
                                </label>
                            ) : null}
                            <label className="auth-field">
                                <span>Email</span>
                                <input name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
                            </label>
                            <PasswordField
                                label="Password"
                                name="password"
                                placeholder={authMode === "signin" ? "Password" : "At least 12 characters"}
                                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                            />
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting
                                    ? authMode === "signin" ? "Signing in..." : "Creating account..."
                                    : authMode === "signin" ? "Sign in" : "Create account"}
                            </button>
                        </form>
                    )}

                    {!resetToken ? (
                        <p className="auth-switch muted">
                            {authMode === "signin" ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError(null);
                                            setStatusMessage(null);
                                            setAuthMode("reset-request");
                                        }}
                                    >
                                        Forgot password?
                                    </button>
                                    <span aria-hidden="true"> · </span>
                                    New to goldshelf?{" "}
                                </>
                            ) : authMode === "reset-request" ? "Remembered it?" : "Already have an account?"}{" "}
                            <button
                                type="button"
                                onClick={() => {
                                    setError(null);
                                    setStatusMessage(null);
                                    setAuthMode((currentMode) => currentMode === "signin" ? "signup" : "signin");
                                }}
                            >
                                {authMode === "signin" ? "Create an account" : "Sign in"}
                            </button>
                        </p>
                    ) : null}
                </section>
            </div>
        </main>
    );
}

function PasswordField({
    label,
    name,
    placeholder,
    autoComplete
}: {
    label: string;
    name: string;
    placeholder: string;
    autoComplete: string;
}) {
    const [visible, setVisible] = useState(false);

    return (
        <label className="auth-field">
            <span>{label}</span>
            <span className="password-field">
                <input
                    name={name}
                    type={visible ? "text" : "password"}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    required
                />
                <button
                    aria-label={visible ? "Hide password" : "Show password"}
                    type="button"
                    onClick={() => setVisible((isVisible) => !isVisible)}
                >
                    <EyeIcon hidden={visible} />
                </button>
            </span>
        </label>
    );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
    return (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
            <path
                d="M2.75 12s3.25-6 9.25-6 9.25 6 9.25 6-3.25 6-9.25 6-9.25-6-9.25-6Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
            <path
                d="M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
            {hidden ? (
                <path
                    d="M4 20 20 4"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                />
            ) : null}
        </svg>
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

async function requestPasswordResetEmail({ email }: { email: string }) {
    const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            email: email.trim(),
            redirectTo: "https://goldshelf.net/"
        })
    });

    if (!response.ok) {
        throw new Error(await readAuthError(response, "Password reset request failed"));
    }
}

async function signInWithEmail({
    email,
    password
}: {
    email: string;
    password: string;
}) {
    const result = await signIn.email({
        email: email.trim(),
        password,
        callbackURL: "/"
    });

    if (result.error) {
        throw new Error(result.error.message || result.error.code || "Sign in failed");
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

function formatAuthError(error: unknown, mode: AuthMode, minPasswordLength: number) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes("too many") || normalizedMessage.includes("rate")) {
        return "Too many attempts. Try again later.";
    }

    if (mode === "signin") {
        return "Email or password is incorrect.";
    }

    if (
        normalizedMessage.includes("password") &&
        (
            normalizedMessage.includes("character") ||
            normalizedMessage.includes("length") ||
            normalizedMessage.includes("short")
        )
    ) {
        return passwordLengthMessage(minPasswordLength);
    }

    return message;
}

function passwordLengthMessage(minPasswordLength: number) {
    return `Use at least ${minPasswordLength} characters.\nLonger passphrases are more secure.`;
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
    const result = await signUp.email({
        email: email.trim(),
        password,
        name: name.trim() || email.trim(),
        callbackURL: "/"
    });

    if (result.error) {
        throw new Error(result.error.message || result.error.code || "Account creation failed");
    }
}

function Dashboard({
    initialDashboard,
    userImage,
    userName
}: {
    initialDashboard: DashboardData;
    userImage: string | null;
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
    const busyRef = useRef(false);
    const [busyLabel, setBusyLabel] = useState<string | null>(null);
    const [imagePickerTarget, setImagePickerTarget] = useState<ImagePickerTarget | null>(null);
    const [importToastOpen, setImportToastOpen] = useState(false);
    const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<CategoryWithEntries | null>(null);
    const [imageRefreshVersion, setImageRefreshVersion] = useState(0);
    const [autoImagePromptedIds, setAutoImagePromptedIds] = useState<Set<string>>(() => new Set());
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
    const [currentUserName, setCurrentUserName] = useState(userName);
    const [currentUserImage, setCurrentUserImage] = useState(userImage);
    const [currentUserImageVersion, setCurrentUserImageVersion] = useState(0);
    const [toasts, setToasts] = useState<AppToast[]>([]);
    const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
    const [entryDragPreview, setEntryDragPreview] = useState<EntryDragPreview | null>(null);
    const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
    const [categoryDragPreview, setCategoryDragPreview] = useState<CategoryDragPreview | null>(null);
    const mainRef = useRef<HTMLElement | null>(null);
    const reversibleActionIdRef = useRef(0);
    const undoStackRef = useRef<ReversibleAction[]>([]);
    const redoStackRef = useRef<ReversibleAction[]>([]);
    const toastIdRef = useRef(0);
    const toastTimeoutsRef = useRef<Map<number, number>>(new Map());

    const selectedCategory = useMemo(
        () =>
            dashboard.categories.find((category) => category.id === selectedCategoryId) ??
            dashboard.categories[0] ??
            null,
        [dashboard.categories, selectedCategoryId]
    );
    const previewedCategories = useMemo(
        () => previewCategoryReorder(dashboard.categories, categoryDragPreview),
        [categoryDragPreview, dashboard.categories]
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
    const previewedEntries = useMemo(
        () => previewEntryReorder(displayedEntries, entryDragPreview),
        [displayedEntries, entryDragPreview]
    );
    const canDragReorderEntries = Boolean(
        selectedCategory &&
        !activeSessionId &&
        !entrySearch.trim() &&
        selectedCategory.entries.length > 1
    );
    const canDragReorderCategories = !busy && dashboard.categories.length > 1;

    useEffect(() => {
        setDraggedEntryId(null);
        setEntryDragPreview(null);
    }, [activeSessionId, entrySearch, selectedCategoryId]);

    useEffect(() => {
        if (!canDragReorderCategories) {
            setDraggedCategoryId(null);
            setCategoryDragPreview(null);
        }
    }, [canDragReorderCategories]);

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
        saveThemeMode(themeMode);
        return applyThemeMode(themeMode);
    }, [themeMode]);

    useEffect(() => {
        busyRef.current = busy;
    }, [busy]);

    useEffect(() => () => {
        for (const timeoutId of toastTimeoutsRef.current.values()) {
            window.clearTimeout(timeoutId);
        }
        toastTimeoutsRef.current.clear();
    }, []);

    useEffect(() => {
        setCurrentUserName(userName);
    }, [userName]);

    useEffect(() => {
        setCurrentUserImage(userImage);
        setCurrentUserImageVersion((version) => version + 1);
    }, [userImage]);

    useEffect(() => {
        setDraggedEntryId(null);
    }, [selectedCategoryId]);

    useEffect(() => {
        if (!canDragReorderEntries) {
            setDraggedEntryId(null);
        }
    }, [canDragReorderEntries]);

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
        busyRef.current = true;
        setBusy(true);
        setBusyLabel(label);
    }

    function finishBusy() {
        busyRef.current = false;
        setBusy(false);
        setBusyLabel(null);
    }

    function scrollMainToTop() {
        window.requestAnimationFrame(() => {
            mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }

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
        const nextToast = { ...toast, id };
        setToasts((currentToasts) => [...currentToasts.filter((item) => item.id !== id), nextToast]);

        const timeoutId = window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS);
        toastTimeoutsRef.current.set(id, timeoutId);
        return id;
    }

    function setMessage(message: string | null, variant: AppToast["variant"] = "default") {
        if (!message) {
            return;
        }

        pushToast({ message, variant });
    }

    function setErrorMessage(error: unknown) {
        setMessage(errorMessage(error), "danger");
    }

    function takeReversibleAction(stack: ReversibleAction[], actionId?: number) {
        const actionIndex = actionId === undefined
            ? stack.length - 1
            : stack.findIndex((action) => action.id === actionId);
        if (actionIndex < 0) {
            return { action: null, nextStack: stack };
        }

        return {
            action: stack[actionIndex],
            nextStack: [
                ...stack.slice(0, actionIndex),
                ...stack.slice(actionIndex + 1)
            ]
        };
    }

    function addReversibleAction(stack: ReversibleAction[], action: ReversibleAction) {
        return [...stack, action].slice(-UNDO_STACK_LIMIT);
    }

    function registerReversibleAction(actionOptions: Omit<ReversibleAction, "id">) {
        const action = {
            ...actionOptions,
            id: reversibleActionIdRef.current + 1
        };
        reversibleActionIdRef.current = action.id;
        undoStackRef.current = addReversibleAction(undoStackRef.current, action);
        redoStackRef.current = [];

        pushToast({
            actionLabel: "Undo",
            message: action.redoToastMessage,
            onAction: () => performUndo(action.id),
            variant: action.variant
        });
    }

    async function performUndo(actionId?: number) {
        if (busyRef.current) {
            return;
        }

        const { action, nextStack } = takeReversibleAction(undoStackRef.current, actionId);
        if (!action) {
            return;
        }

        startBusy("Undoing...");
        setMessage(null);

        try {
            await action.undo();
            undoStackRef.current = nextStack;
            redoStackRef.current = addReversibleAction(redoStackRef.current, action);
            pushToast({
                actionLabel: "Redo",
                message: action.undoToastMessage,
                onAction: () => performRedo(action.id),
                variant: "success"
            });
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    async function performRedo(actionId?: number) {
        if (busyRef.current) {
            return;
        }

        const { action, nextStack } = takeReversibleAction(redoStackRef.current, actionId);
        if (!action) {
            return;
        }

        startBusy("Redoing...");
        setMessage(null);

        try {
            await action.redo();
            redoStackRef.current = nextStack;
            undoStackRef.current = addReversibleAction(undoStackRef.current, action);
            pushToast({
                actionLabel: "Undo",
                message: action.redoToastMessage,
                onAction: () => performUndo(action.id),
                variant: action.variant
            });
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    useEffect(() => {
        function handleUndoRedoShortcut(event: KeyboardEvent) {
            if (
                event.defaultPrevented ||
                event.altKey ||
                !(event.metaKey || event.ctrlKey) ||
                isEditableShortcutTarget(event.target)
            ) {
                return;
            }

            const key = event.key.toLowerCase();
            const isUndo = key === "z" && !event.shiftKey;
            const isRedo = (key === "z" && event.shiftKey) || key === "y";
            if (!isUndo && !isRedo) {
                return;
            }

            event.preventDefault();
            if (isRedo) {
                void performRedo();
            } else {
                void performUndo();
            }
        }

        document.addEventListener("keydown", handleUndoRedoShortcut);
        return () => document.removeEventListener("keydown", handleUndoRedoShortcut);
    }, []);

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
            setErrorMessage(error);
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
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    function handleCategoryDragStart(categoryId: string) {
        setDraggedCategoryId(categoryId);
        setCategoryDragPreview(null);
    }

    function handleCategoryDragPreview(
        categoryId: string,
        targetCategoryId: string,
        placement: DropPlacement
    ) {
        if (!canDragReorderCategories || categoryId === targetCategoryId) {
            return;
        }

        setCategoryDragPreview((currentPreview) => {
            if (
                currentPreview?.draggedCategoryId === categoryId &&
                currentPreview.targetCategoryId === targetCategoryId &&
                currentPreview.placement === placement
            ) {
                return currentPreview;
            }

            return { draggedCategoryId: categoryId, targetCategoryId, placement };
        });
    }

    function handleCategoryDragEnd() {
        setDraggedCategoryId(null);
        setCategoryDragPreview(null);
    }

    function handleCommitCategoryDragPreview() {
        if (!categoryDragPreview) {
            handleCategoryDragEnd();
            return;
        }

        void handleMoveCategoryRelativeToCategory(
            categoryDragPreview.draggedCategoryId,
            categoryDragPreview.targetCategoryId,
            categoryDragPreview.placement
        );
    }

    async function handleMoveCategoryRelativeToCategory(
        categoryId: string,
        targetCategoryId: string,
        placement: DropPlacement
    ) {
        if (categoryId === targetCategoryId) {
            handleCategoryDragEnd();
            return;
        }

        const orderedCategoryIds = dashboard.categories.map((category) => category.id);
        const originalCategoryIndex = orderedCategoryIds.indexOf(categoryId);
        if (isReorderNoop(orderedCategoryIds, categoryId, targetCategoryId, placement)) {
            handleCategoryDragEnd();
            return;
        }

        const previousCategoryId = originalCategoryIndex > 0 ? orderedCategoryIds[originalCategoryIndex - 1] : null;
        const nextCategoryId = originalCategoryIndex >= 0 ? orderedCategoryIds[originalCategoryIndex + 1] ?? null : null;
        startBusy("Reordering categories...");
        setMessage(null);

        try {
            const result = await moveCategoryRelativeToCategoryForHistory(categoryId, targetCategoryId, placement);
            if (result.moved && originalCategoryIndex >= 0) {
                registerReversibleAction({
                    redo: () => moveCategoryRelativeToCategoryForHistory(categoryId, targetCategoryId, placement).then(() => undefined),
                    redoToastMessage: "Reordered categories.",
                    undo: () => restoreCategoryOrderForHistory(categoryId, previousCategoryId, nextCategoryId),
                    undoToastMessage: "Restored the previous category order.",
                    variant: "success"
                });
            }
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
            handleCategoryDragEnd();
        }
    }

    async function moveCategoryRelativeToCategoryForHistory(
        categoryId: string,
        targetCategoryId: string,
        placement: DropPlacement
    ) {
        const result = await moveCategoryRelativeToCategory({ data: { categoryId, targetCategoryId, placement } });
        await refresh();
        return result;
    }

    async function restoreCategoryOrderForHistory(
        categoryId: string,
        previousCategoryId: string | null,
        nextCategoryId: string | null
    ) {
        if (nextCategoryId) {
            await moveCategoryRelativeToCategoryForHistory(categoryId, nextCategoryId, "before");
            return;
        }

        if (previousCategoryId) {
            await moveCategoryRelativeToCategoryForHistory(categoryId, previousCategoryId, "after");
            return;
        }

        await refresh();
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
            pushToast({
                message: `Deleted ${category.name}.`,
                variant: "danger"
            });
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        if (dashboard.categories.length === 0) {
            return;
        }

        setMessage(null);
        const form = new FormData(formElement);
        const name = String(form.get("name") ?? "");
        const cleanName = name.trim();
        const targetCategoryId = String(form.get("categoryId") ?? selectedCategory?.id ?? "");
        const targetCategory = dashboard.categories.find((category) => category.id === targetCategoryId);
        if (!cleanName || !targetCategory) {
            setMessage("Choose a category and enter a name.", "danger");
            return;
        }

        startBusy("Adding entry...");
        const firstConsumedAt = currentDateTimestamp();

        try {
            if (dashboard.queueSettings.enabled) {
                const result = await createQueuedEntry({
                    data: {
                        categoryId: targetCategory.id,
                        name: cleanName,
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
                        category: targetCategory
                    });
                }
                await refresh();
                return;
            }

            const result = await createEntryWithBinaryRanking({
                data: {
                    categoryId: targetCategory.id,
                    name: cleanName,
                    firstConsumedAt
                }
            });
            formElement.reset();

            setSelectedCategoryId(targetCategory.id);
            if (result.kind === "session") {
                setActiveBinarySessionId(result.sessionId);
            }

            await refresh();
        } catch (error) {
            setErrorMessage(error);
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
            setErrorMessage(error);
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
            setErrorMessage(error);
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
            setErrorMessage(error);
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

    async function removeQueuedEntryForHistory(entry: QueuedEntry) {
        await deleteQueuedEntry({ data: { queuedEntryId: entry.id } });
        await refresh();
    }

    async function restoreQueuedEntryForHistory(entry: QueuedEntry) {
        await restoreQueuedEntry({ data: { queuedEntryId: entry.id } });
        await refresh();
    }

    async function handleDeleteQueuedEntry(entry: QueuedEntry) {
        startBusy("Removing queued entry...");
        setMessage(null);

        try {
            await removeQueuedEntryForHistory(entry);
            registerReversibleAction({
                redo: () => removeQueuedEntryForHistory(entry),
                redoToastMessage: `Removed ${entry.name} from the queue.`,
                undo: () => restoreQueuedEntryForHistory(entry),
                undoToastMessage: `Restored ${entry.name} to the queue.`,
                variant: "danger"
            });
        } catch (error) {
            setErrorMessage(error);
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
            setErrorMessage(error);
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
                setActiveBinarySessionId(result.sessionId);
                scrollMainToTop();
            }
            await refresh();
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    function handleEntryDragStart(entryId: string) {
        setDraggedEntryId(entryId);
        setEntryDragPreview(null);
    }

    function handleEntryDragPreview(
        entryId: string,
        targetEntryId: string,
        placement: DropPlacement
    ) {
        if (!canDragReorderEntries || entryId === targetEntryId) {
            return;
        }

        setEntryDragPreview((currentPreview) => {
            if (
                currentPreview?.draggedEntryId === entryId &&
                currentPreview.targetEntryId === targetEntryId &&
                currentPreview.placement === placement
            ) {
                return currentPreview;
            }

            return { draggedEntryId: entryId, targetEntryId, placement };
        });
    }

    function handleEntryDragEnd() {
        setDraggedEntryId(null);
        setEntryDragPreview(null);
    }

    function handleCommitEntryDragPreview() {
        if (!entryDragPreview) {
            handleEntryDragEnd();
            return;
        }

        void handleMoveEntryRelativeToEntry(
            entryDragPreview.draggedEntryId,
            entryDragPreview.targetEntryId,
            entryDragPreview.placement
        );
    }

    async function handleMoveEntryRelativeToEntry(
        entryId: string,
        targetEntryId: string,
        placement: DropPlacement
    ) {
        if (entryId === targetEntryId) {
            handleEntryDragEnd();
            return;
        }

        const orderedEntryIds = selectedCategory ? orderEntries(selectedCategory.entries).map((entry) => entry.id) : [];
        const originalEntryIndex = orderedEntryIds.indexOf(entryId);
        if (isReorderNoop(orderedEntryIds, entryId, targetEntryId, placement)) {
            handleEntryDragEnd();
            return;
        }

        const previousEntryId = originalEntryIndex > 0 ? orderedEntryIds[originalEntryIndex - 1] : null;
        const nextEntryId = originalEntryIndex >= 0 ? orderedEntryIds[originalEntryIndex + 1] ?? null : null;
        startBusy("Reordering entries...");
        setMessage(null);

        try {
            const result = await moveEntryRelativeToEntryForHistory(entryId, targetEntryId, placement);
            if (result.moved && originalEntryIndex >= 0) {
                registerReversibleAction({
                    redo: () => moveEntryRelativeToEntryForHistory(entryId, targetEntryId, placement).then(() => undefined),
                    redoToastMessage: "Reordered entries.",
                    undo: () => restoreEntryOrderForHistory(entryId, previousEntryId, nextEntryId),
                    undoToastMessage: "Restored the previous order.",
                    variant: "success"
                });
            }
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
            handleEntryDragEnd();
        }
    }

    async function moveEntryRelativeToEntryForHistory(
        entryId: string,
        targetEntryId: string,
        placement: DropPlacement
    ) {
        const result = await moveEntryRelativeToEntry({ data: { entryId, targetEntryId, placement } });
        await refresh();
        return result;
    }

    async function restoreEntryOrderForHistory(
        entryId: string,
        previousEntryId: string | null,
        nextEntryId: string | null
    ) {
        if (nextEntryId) {
            await moveEntryRelativeToEntryForHistory(entryId, nextEntryId, "before");
            return;
        }

        if (previousEntryId) {
            await moveEntryRelativeToEntryForHistory(entryId, previousEntryId, "after");
            return;
        }

        await refresh();
    }

    async function handleRename(entryId: string, name: string) {
        startBusy("Renaming entry...");
        setMessage(null);

        try {
            await renameEntry({ data: { entryId, name } });
            await refresh();
        } catch (error) {
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    async function deleteEntryForHistory(entry: Entry) {
        await deleteEntry({ data: { entryId: entry.id } });
        await refresh();
    }

    async function restoreEntryForHistory(entry: Entry) {
        await restoreEntry({ data: { entryId: entry.id } });
        await refresh();
    }

    async function handleDelete(entry: Entry) {
        startBusy("Deleting entry...");
        setMessage(null);

        try {
            await deleteEntryForHistory(entry);
            registerReversibleAction({
                redo: () => deleteEntryForHistory(entry),
                redoToastMessage: `Deleted ${entry.name}.`,
                undo: () => restoreEntryForHistory(entry),
                undoToastMessage: `Restored ${entry.name}.`,
                variant: "danger"
            });
        } catch (error) {
            setErrorMessage(error);
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
            setErrorMessage(error);
        } finally {
            finishBusy();
        }
    }

    async function handleCancelBinarySession(session: BinarySessionView) {
        startBusy(
            session.source === "rerank_entry"
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
                session.source === "rerank_entry"
                    ? `Cancelled reranking ${session.subject.name}.`
                    : `Cancelled adding ${session.subject.name}.`
            );
            await refresh();
        } catch (error) {
            setErrorMessage(error);
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

        setMessage("That ranking is no longer active.", "danger");
    }

    async function handleImport(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        startBusy("Reading spreadsheet...");
        setMessage(null);
        const form = new FormData(formElement);
        const file = form.get("workbook");

        if (!(file instanceof File) || file.size === 0) {
            pushToast({
                message: "Choose an .xlsx file to import.",
                variant: "danger"
            });
            finishBusy();
            return false;
        }

        try {
            await nextPaint();
            const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));
            const buffer = await file.arrayBuffer();
            setBusyLabel("Parsing spreadsheet...");
            await nextPaint();
            const parsed = await parseLegacyWorkbook(buffer, firstConsumedAt);
            if (parsed.entries.length === 0) {
                throw new Error("Spreadsheet contains no importable entries. Put category names in the first row and entries below them.");
            }
            setBusyLabel(`Importing ${parsed.entries.length} entries...`);
            await nextPaint();
            const result = await importLegacyEntries({ data: parsed });
            setBusyLabel("Refreshing dashboard...");
            pushToast({
                message: result.skippedCount > 0
                    ? `Imported ${result.importedCount} entries. Skipped ${result.skippedCount} duplicates.`
                    : `Imported ${result.importedCount} entries.`,
                variant: "success"
            });
            formElement.reset();
            await refresh();
            return true;
        } catch (error) {
            pushToast({
                message: errorMessage(error),
                variant: "danger"
            });
            return false;
        } finally {
            finishBusy();
        }
    }

    async function handleExport() {
        startBusy("Preparing export...");
        setMessage(null);
        try {
            await nextPaint();
            const entryCount = dashboard.categories.reduce(
                (count, category) => count + category.entries.length,
                0
            );
            if (entryCount === 0) {
                pushToast({
                    message: "Nothing to export yet. Add or import entries first."
                });
                return;
            }
            const buffer = await writeExportWorkbook(dashboard.categories);
            const blob = new Blob([buffer], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "Rankings.xlsx";
            anchor.click();
            URL.revokeObjectURL(url);
            pushToast({
                message: "Export downloaded.",
                variant: "success"
            });
        } catch (error) {
            pushToast({
                message: errorMessage(error),
                variant: "danger"
            });
        } finally {
            finishBusy();
        }
    }

    return (
        <main className="app-shell" aria-busy={busy}>
            {busy ? <BusyOverlay label={busyLabel ?? "Working..."} /> : null}
            <ToastStack toasts={toasts} onDismiss={dismissToast}>
                {importToastOpen ? (
                    <ImportSpreadsheetToast
                        busy={busy}
                        busyLabel={busyLabel}
                        disabled={busy || Boolean(activeSessionId)}
                        onClose={() => setImportToastOpen(false)}
                        onImport={async (event) => {
                            const imported = await handleImport(event);
                            if (imported) {
                                setImportToastOpen(false);
                            }
                        }}
                    />
                ) : null}
            </ToastStack>
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
                    <Link className="brand-link" to="/">
                        <img src="/favicon.svg" alt="" aria-hidden="true" />
                        <span>Goldshelf</span>
                    </Link>
                    <AccountMenu
                        busy={busy}
                        listLocked={Boolean(activeSessionId)}
                        settings={dashboard.queueSettings}
                        onExport={handleExport}
                        onOpenImport={() => setImportToastOpen(true)}
                        onSaveSettings={handleQueueSettings}
                        onThemeChange={setThemeMode}
                        themeMode={themeMode}
                        userImage={currentUserImage}
                        userImageVersion={currentUserImageVersion}
                        userName={currentUserName}
                    />
                </div>

                <form className="form-row" onSubmit={handleCreateCategory}>
                    <input disabled={busy} name="name" placeholder="New category" required />
                    <button disabled={busy} type="submit">Add</button>
                </form>

                <div
                    className="category-list"
                    onDragOver={(event) => {
                        if (!draggedCategoryId || !categoryDragPreview) {
                            return;
                        }

                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                        if (!draggedCategoryId || !categoryDragPreview) {
                            return;
                        }

                        event.preventDefault();
                        handleCommitCategoryDragPreview();
                    }}
                >
                    {previewedCategories.map((category) => (
                        <CategoryListItem
                            category={category}
                            isActive={category.id === selectedCategory?.id}
                            key={category.id}
                            busy={busy}
                            canDragReorder={canDragReorderCategories}
                            draggedCategoryId={draggedCategoryId}
                            isDragging={draggedCategoryId === category.id}
                            listLocked={Boolean(activeSessionId)}
                            onDragEnd={handleCategoryDragEnd}
                            onDragPreview={handleCategoryDragPreview}
                            onDragStart={() => handleCategoryDragStart(category.id)}
                            onDropCategory={handleMoveCategoryRelativeToCategory}
                            onDropPreview={handleCommitCategoryDragPreview}
                            onDelete={() => setCategoryDeleteTarget(category)}
                            onRename={(name) => handleRenameCategory(category.id, name)}
                            onSelect={() => setSelectedCategoryId(category.id)}
                        />
                    ))}
                    {dashboard.categories.length === 0 ? (
                        <EmptyState
                            compact
                            icon="category"
                            title="No Categories"
                        >
                            Add a category to start building a ranked list.
                        </EmptyState>
                    ) : null}
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
                </div>

                {dashboard.categories.length === 0 ? (
                    <EmptyState
                        icon="category"
                        title="Create Your First Category"
                    >
                        Categories keep each ranked list separate. Use the sidebar form to add one.
                    </EmptyState>
                ) : null}

                {selectedCategory && !activeSessionId ? (
                    <div className="entry-control-stack">
                        <form className="entry-create-form" onSubmit={handleCreateEntry}>
                            <input disabled={busy} name="name" placeholder="New entry" required />
                            <div className="entry-create-row">
                                <select
                                    aria-label="Category"
                                    className="category-select"
                                    defaultValue={selectedCategory.id}
                                    disabled={busy}
                                    key={selectedCategory.id}
                                    name="categoryId"
                                >
                                    {dashboard.categories.map((category) => (
                                        <option key={category.id} value={category.id}>
                                            {category.name}
                                        </option>
                                    ))}
                                </select>
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

                <section
                    className="entries-grid"
                    onDragOver={(event) => {
                        if (!draggedEntryId || !entryDragPreview) {
                            return;
                        }

                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                        if (!draggedEntryId || !entryDragPreview) {
                            return;
                        }

                        event.preventDefault();
                        handleCommitEntryDragPreview();
                    }}
                >
                    {selectedCategory ? previewedEntries.map((entry) => (
                        <EntryCard
                            entry={entry}
                            categories={dashboard.categories}
                            key={entry.id}
                            canDragReorder={canDragReorderEntries}
                            draggedEntryId={draggedEntryId}
                            isDragging={draggedEntryId === entry.id}
                            listLocked={Boolean(activeSessionId)}
                            selectedCategoryId={selectedCategory.id}
                            onDelete={() => handleDelete(entry)}
                            onDragEnd={handleEntryDragEnd}
                            onDragPreview={handleEntryDragPreview}
                            onDragStart={() => handleEntryDragStart(entry.id)}
                            onDropPreview={handleCommitEntryDragPreview}
                            onDropEntry={handleMoveEntryRelativeToEntry}
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
                    <EmptyState
                        icon={entrySearch.trim() ? "search" : "rank"}
                        title={entrySearch.trim() ? "No Matches" : "No Entries Yet"}
                    >
                        {entrySearch.trim()
                            ? "Try a different search term or clear the search field."
                            : dashboard.queueSettings.enabled
                                ? "Add entries above to queue them for ranking."
                                : "Add an entry above to start ranking this category."}
                    </EmptyState>
                ) : null}
            </section>
        </main>
    );
}

function isReorderNoop(
    orderedItemIds: string[],
    itemId: string,
    targetItemId: string,
    placement: DropPlacement
) {
    if (itemId === targetItemId) {
        return true;
    }

    const originalItemIndex = orderedItemIds.indexOf(itemId);
    const targetItemIndex = orderedItemIds.indexOf(targetItemId);
    return originalItemIndex >= 0 &&
        targetItemIndex >= 0 &&
        (
            (placement === "before" && targetItemIndex === originalItemIndex + 1) ||
            (placement === "after" && targetItemIndex === originalItemIndex - 1)
        );
}

function previewEntryReorder(entries: Entry[], preview: EntryDragPreview | null) {
    if (!preview || preview.draggedEntryId === preview.targetEntryId) {
        return entries;
    }

    const draggedIndex = entries.findIndex((entry) => entry.id === preview.draggedEntryId);
    const targetIndex = entries.findIndex((entry) => entry.id === preview.targetEntryId);
    if (draggedIndex < 0 || targetIndex < 0) {
        return entries;
    }

    const nextEntries = entries.slice();
    const [draggedEntry] = nextEntries.splice(draggedIndex, 1);
    const targetIndexAfterRemoval = nextEntries.findIndex((entry) => entry.id === preview.targetEntryId);
    if (!draggedEntry || targetIndexAfterRemoval < 0) {
        return entries;
    }

    const insertionIndex = preview.placement === "before"
        ? targetIndexAfterRemoval
        : targetIndexAfterRemoval + 1;
    nextEntries.splice(insertionIndex, 0, draggedEntry);
    return nextEntries;
}

function previewCategoryReorder(categories: CategoryWithEntries[], preview: CategoryDragPreview | null) {
    if (!preview || preview.draggedCategoryId === preview.targetCategoryId) {
        return categories;
    }

    const draggedIndex = categories.findIndex((category) => category.id === preview.draggedCategoryId);
    const targetIndex = categories.findIndex((category) => category.id === preview.targetCategoryId);
    if (draggedIndex < 0 || targetIndex < 0) {
        return categories;
    }

    const nextCategories = categories.slice();
    const [draggedCategory] = nextCategories.splice(draggedIndex, 1);
    const targetIndexAfterRemoval = nextCategories.findIndex((category) => category.id === preview.targetCategoryId);
    if (!draggedCategory || targetIndexAfterRemoval < 0) {
        return categories;
    }

    const insertionIndex = preview.placement === "before"
        ? targetIndexAfterRemoval
        : targetIndexAfterRemoval + 1;
    nextCategories.splice(insertionIndex, 0, draggedCategory);
    return nextCategories;
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

function isEditableShortcutTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return target.isContentEditable || target.matches("input, textarea, select");
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

function useFloatingMenu(
    isOpen: boolean,
    anchorPoint: { left: number; top: number } | null = null
) {
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

        const panel = panelRef.current;
        if (!panel) {
            return;
        }

        const margin = 8;
        const gap = 6;
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;

        const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
        const trigger = triggerRef.current;
        if (!anchorPoint && !trigger) {
            return;
        }

        const triggerRect = trigger?.getBoundingClientRect();
        const preferredLeft = anchorPoint
            ? anchorPoint.left
            : (triggerRect?.right ?? margin) - panelWidth;
        const preferredTop = anchorPoint
            ? anchorPoint.top
            : (triggerRect?.bottom ?? margin) + gap;
        const flippedTop = anchorPoint
            ? anchorPoint.top - panelHeight
            : (triggerRect?.top ?? margin) - panelHeight - gap;

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
    }, [anchorPoint, isOpen]);

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

function Icon({ name }: { name: IconName }) {
    return (
        <span aria-hidden="true" className="button-icon">
            {ICONS[name]}
        </span>
    );
}

function IconButton({
    className = "",
    icon,
    label,
    title,
    ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon: IconName;
    label: string;
}) {
    return (
        <button
            {...props}
            aria-label={label}
            className={`icon-button ${className}`.trim()}
            title={title ?? label}
        >
            <Icon name={icon} />
        </button>
    );
}

function MenuIconLabel({
    children,
    icon
}: {
    children: ReactNode;
    icon: IconName;
}) {
    return (
        <span className="menu-icon-label">
            <Icon name={icon} />
            <span>{children}</span>
        </span>
    );
}

function EmptyState({
    children,
    compact = false,
    icon,
    title
}: {
    children: ReactNode;
    compact?: boolean;
    icon: IconName;
    title: string;
}) {
    return (
        <section className={`empty-state ${compact ? "compact" : ""}`}>
            <div className="empty-state-icon">
                <Icon name={icon} />
            </div>
            <div>
                <strong>{title}</strong>
                <p className="muted">{children}</p>
            </div>
        </section>
    );
}

function ToastStack({
    children,
    onDismiss,
    toasts
}: {
    children?: ReactNode;
    onDismiss: (toastId: number) => void;
    toasts: AppToast[];
}) {
    const [activeActionId, setActiveActionId] = useState<number | null>(null);

    if (toasts.length === 0 && !children) {
        return null;
    }

    return (
        <div aria-live="polite" className="toast-stack">
            {children}
            {toasts.map((toast) => (
                <div className={`toast ${toast.variant ?? "default"}`} key={toast.id} role="status">
                    <span>{toast.message}</span>
                    {toast.actionLabel && toast.onAction ? (
                        <button
                            className="small-button toast-action"
                            disabled={activeActionId === toast.id}
                            type="button"
                            onClick={async () => {
                                setActiveActionId(toast.id);
                                try {
                                    await toast.onAction?.();
                                    onDismiss(toast.id);
                                } finally {
                                    setActiveActionId(null);
                                }
                            }}
                        >
                            {activeActionId === toast.id ? "Working..." : toast.actionLabel}
                        </button>
                    ) : null}
                    <IconButton
                        className="toast-close-button"
                        icon="close"
                        label="Dismiss notification"
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                    />
                </div>
            ))}
        </div>
    );
}

function ImportSpreadsheetToast({
    busy,
    busyLabel,
    disabled,
    onClose,
    onImport
}: {
    busy: boolean;
    busyLabel: string | null;
    disabled: boolean;
    onClose: () => void;
    onImport: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
    return (
        <form className="toast import-toast" onSubmit={(event) => void onImport(event)}>
            <div className="toast-header-row">
                <strong>Import Spreadsheet</strong>
                <IconButton
                    className="toast-close-button"
                    disabled={busy}
                    icon="close"
                    label="Close import"
                    type="button"
                    onClick={onClose}
                />
            </div>
            <label className="stack compact-stack">
                <span className="muted">First consumed date</span>
                <input disabled={disabled} name="firstConsumedAt" type="date" />
            </label>
            <label className="stack compact-stack">
                <span className="muted">Workbook</span>
                <input disabled={disabled} name="workbook" type="file" accept=".xlsx" />
            </label>
            <button disabled={disabled} type="submit">
                {busyLabel?.startsWith("Import") ? "Importing..." : "Import"}
            </button>
        </form>
    );
}

function CategoryListItem({
    category,
    isActive,
    busy,
    canDragReorder,
    draggedCategoryId,
    isDragging,
    listLocked,
    onDragEnd,
    onDragPreview,
    onDragStart,
    onDropCategory,
    onDropPreview,
    onDelete,
    onRename,
    onSelect
}: {
    category: CategoryWithEntries;
    isActive: boolean;
    busy: boolean;
    canDragReorder: boolean;
    draggedCategoryId: string | null;
    isDragging: boolean;
    listLocked: boolean;
    onDragEnd: () => void;
    onDragPreview: (categoryId: string, targetCategoryId: string, placement: DropPlacement) => void;
    onDragStart: () => void;
    onDropCategory: (categoryId: string, targetCategoryId: string, placement: DropPlacement) => Promise<void>;
    onDropPreview: () => void;
    onDelete: () => void;
    onRename: (name: string) => Promise<void>;
    onSelect: () => void;
}) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPoint, setMenuPoint] = useState<{ left: number; top: number } | null>(null);
    const [name, setName] = useState(category.name);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen, menuPoint);
    useEscapeKey(isRenaming, () => { setName(category.name); setIsRenaming(false); });

    useEffect(() => {
        setName(category.name);
        setIsRenaming(false);
        setMenuOpen(false);
        setMenuPoint(null);
    }, [category.name]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(name);
        setIsRenaming(false);
    }

    function dragPlacementForEvent(event: DragEvent<HTMLElement>): DropPlacement {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    }

    function setCategoryDragImage(event: DragEvent<HTMLElement>) {
        const row = event.currentTarget;
        const rect = row.getBoundingClientRect();
        const dragImage = row.cloneNode(true) as HTMLElement;
        dragImage.classList.remove("dragging");
        dragImage.classList.add("category-drag-image");
        dragImage.style.width = `${rect.width}px`;
        dragImage.style.height = `${rect.height}px`;
        dragImage.style.position = "fixed";
        dragImage.style.left = "-10000px";
        dragImage.style.top = "-10000px";
        dragImage.style.pointerEvents = "none";
        dragImage.querySelector(".context-menu-host")?.remove();
        document.body.appendChild(dragImage);

        const offsetX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const offsetY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
        window.setTimeout(() => dragImage.remove(), 0);
    }

    const isCategoryDraggable = canDragReorder && !isRenaming && !menuOpen;

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
        <div
            className={`category-row ${isCategoryDraggable ? "draggable" : ""} ${isDragging ? "dragging" : ""}`}
            data-category-id={category.id}
            draggable={isCategoryDraggable}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
                if (!isCategoryDraggable || !draggedCategoryId || isDragging) {
                    return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onDragPreview(draggedCategoryId, category.id, dragPlacementForEvent(event));
            }}
            onDragStart={(event) => {
                if (!isCategoryDraggable) {
                    event.preventDefault();
                    return;
                }

                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-goldshelf-category-id", category.id);
                event.dataTransfer.setData("text/plain", `category:${category.id}`);
                setCategoryDragImage(event);
                setMenuOpen(false);
                onDragStart();
            }}
            onDrop={(event) => {
                if (!isCategoryDraggable) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                const plainData = event.dataTransfer.getData("text/plain");
                const droppedCategoryId =
                    event.dataTransfer.getData("application/x-goldshelf-category-id") ||
                    (plainData.startsWith("category:") ? plainData.slice("category:".length) : "") ||
                    draggedCategoryId;
                if (droppedCategoryId && droppedCategoryId !== category.id) {
                    void onDropCategory(droppedCategoryId, category.id, dragPlacementForEvent(event));
                } else if (droppedCategoryId) {
                    onDropPreview();
                } else {
                    onDragEnd();
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                if (busy) {
                    return;
                }
                setMenuPoint({ left: event.clientX, top: event.clientY });
                setMenuOpen(true);
            }}
        >
            <button
                className={`category-button ${isActive ? "active" : ""}`}
                disabled={busy}
                title="Double-click to rename · Right-click for actions"
                type="button"
                onClick={onSelect}
                onDoubleClick={() => {
                    if (!busy) {
                        setMenuOpen(false);
                        setName(category.name);
                        setIsRenaming(true);
                    }
                }}
            >
                <strong>{category.name}</strong>
                <span className="muted"> · {category.entries.length}</span>
            </button>
            <div className="context-menu-host" ref={menuRef}>
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
                                setName(category.name);
                                setIsRenaming(true);
                            }}
                        >
                            <MenuIconLabel icon="edit">Rename</MenuIconLabel>
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
                            <MenuIconLabel icon="delete">Delete</MenuIconLabel>
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
    listLocked,
    settings,
    onExport,
    onOpenImport,
    onSaveSettings,
    onThemeChange,
    themeMode,
    userImage,
    userImageVersion,
    userName
}: {
    busy: boolean;
    listLocked: boolean;
    settings: QueueSettings;
    onExport: () => Promise<void>;
    onOpenImport: () => void;
    onSaveSettings: (settings: QueueSettings, options?: { quiet?: boolean }) => Promise<void>;
    onThemeChange: (themeMode: ThemeMode) => void;
    themeMode: ThemeMode;
    userImage: string | null;
    userImageVersion: number;
    userName: string;
}) {
    const [enabled, setEnabled] = useState(settings.enabled);
    const [delayDays, setDelayDays] = useState(settings.delayDays);
    const [promptForMissingImages, setPromptForMissingImages] = useState(settings.promptForMissingImages);
    const [quickSaving, setQuickSaving] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<"settings" | "appearance" | null>(null);
    const [submenuAnchorTop, setSubmenuAnchorTop] = useState<number | null>(null);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen);
    const importDisabled = busy || listLocked;

    useEffect(() => {
        setEnabled(settings.enabled);
        setDelayDays(settings.delayDays);
        setPromptForMissingImages(settings.promptForMissingImages);
    }, [
        settings.delayDays,
        settings.enabled,
        settings.promptForMissingImages
    ]);

    async function handleExportClick() {
        setMenuOpen(false);
        clearPanel();
        await onExport();
    }

    async function saveSettingsImmediately(nextSettings: QueueSettings) {
        setQuickSaving(true);
        try {
            await onSaveSettings(nextSettings, { quiet: true });
        } finally {
            setQuickSaving(false);
        }
    }

    async function updateToggle<K extends "enabled" | "promptForMissingImages">(
        key: K,
        value: QueueSettings[K]
    ) {
        if (key === "enabled") {
            setEnabled(Boolean(value));
        } else {
            setPromptForMissingImages(Boolean(value));
        }

        await saveSettingsImmediately({
            ...settings,
            enabled: key === "enabled" ? Boolean(value) : enabled,
            delayDays,
            promptForMissingImages: key === "promptForMissingImages" ? Boolean(value) : promptForMissingImages
        });
    }

    async function updateDelayDays(nextDelayDays: number) {
        setDelayDays(nextDelayDays);
        await saveSettingsImmediately({
            ...settings,
            enabled,
            delayDays: nextDelayDays,
            promptForMissingImages
        });
    }

    function showPanel(panel: "settings" | "appearance", event: { currentTarget: HTMLElement }) {
        setActivePanel(panel);
        setSubmenuAnchorTop(event.currentTarget.getBoundingClientRect().top);
    }

    function clearPanel() {
        setActivePanel(null);
        setSubmenuAnchorTop(null);
    }

    function submenuStyle(width: number): CSSProperties {
        const mainLeft = Number(floatingMenu.style.left ?? 0);
        const mainTop = Number(floatingMenu.style.top ?? 0);
        const mainWidth = floatingMenu.panelRef.current?.offsetWidth ?? 224;
        const margin = 8;
        const gap = 6;
        const preferredLeft = mainLeft - width - gap;
        const fallbackLeft = mainLeft + mainWidth + gap;
        const maxLeft = typeof window === "undefined"
            ? preferredLeft
            : Math.max(margin, window.innerWidth - width - margin);
        const left = preferredLeft >= margin
            ? preferredLeft
            : Math.min(fallbackLeft, maxLeft);

        return {
            left,
            maxWidth: "calc(100vw - 1rem)",
            position: "fixed",
            top: submenuAnchorTop ?? mainTop,
            visibility: floatingMenu.style.visibility,
            minWidth: width,
            width: "auto",
            zIndex: 81
        };
    }

    return (
        <div className="account-menu" ref={menuRef}>
            <button
                aria-label="Account menu"
                aria-expanded={menuOpen}
                className="account-menu-toggle"
                ref={floatingMenu.triggerRef}
                type="button"
                onClick={() => {
                    if (menuOpen) {
                        clearPanel();
                    }
                    setMenuOpen((isOpen) => !isOpen);
                }}
            >
                <AccountAvatar
                    imageKey={userImage}
                    imageVersion={userImageVersion}
                />
            </button>

            {menuOpen ? (
                <div
                    className="account-menu-panel floating-menu-panel"
                    ref={floatingMenu.panelRef}
                    style={floatingMenu.style}
                >
                    <div className="account-menu-header">
                        <AccountAvatar
                            imageKey={userImage}
                            imageVersion={userImageVersion}
                            large
                        />
                        <div>
                            <strong className="account-display-name">{userName}</strong>
                            <span className="muted">Account</span>
                        </div>
                    </div>
                    <Link
                        className="account-menu-item"
                        to="/profile"
                        onClick={() => setMenuOpen(false)}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="edit">Profile</MenuIconLabel>
                    </Link>
                    <button
                        aria-expanded={activePanel === "settings"}
                        className={`account-menu-item has-flyout ${activePanel === "settings" ? "active" : ""}`}
                        type="button"
                        onClick={(event) => showPanel("settings", event)}
                        onFocus={(event) => showPanel("settings", event)}
                        onMouseEnter={(event) => showPanel("settings", event)}
                    >
                        <MenuIconLabel icon="settings">Settings</MenuIconLabel>
                        <span aria-hidden="true">›</span>
                    </button>
                    <button
                        aria-expanded={activePanel === "appearance"}
                        className={`account-menu-item has-flyout ${activePanel === "appearance" ? "active" : ""}`}
                        type="button"
                        onClick={(event) => showPanel("appearance", event)}
                        onFocus={(event) => showPanel("appearance", event)}
                        onMouseEnter={(event) => showPanel("appearance", event)}
                    >
                        <MenuIconLabel icon="reset">Appearance</MenuIconLabel>
                        <span aria-hidden="true">›</span>
                    </button>
                    <button
                        className="account-menu-item"
                        disabled={importDisabled}
                        type="button"
                        onClick={() => {
                            setMenuOpen(false);
                            clearPanel();
                            onOpenImport();
                        }}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="import">Import xlsx</MenuIconLabel>
                    </button>
                    <button
                        className="account-menu-item"
                        disabled={busy}
                        type="button"
                        onClick={() => void handleExportClick()}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="export">Export xlsx</MenuIconLabel>
                    </button>
                    <button
                        className="account-menu-item danger menu-danger"
                        type="button"
                        onClick={() => signOut().then(() => window.location.assign("/"))}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="cancel">Sign Out</MenuIconLabel>
                    </button>
                </div>
            ) : null}
            {menuOpen && activePanel === "settings" ? (
                <div
                    className="account-submenu account-settings-menu floating-menu-panel"
                    style={submenuStyle(150)}
                    onMouseEnter={() => setActivePanel("settings")}
                >
                    <strong>Settings</strong>
                    <div
                        className="settings-toggle-grid"
                        style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}
                    >
                        <label className="checkbox-row">
                            <input
                                checked={promptForMissingImages}
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("promptForMissingImages", event.target.checked)}
                            />
                            <span>Image prompts</span>
                        </label>
                        <label className="checkbox-row">
                            <input
                                checked={enabled}
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("enabled", event.target.checked)}
                            />
                            <span>Queue entries</span>
                        </label>
                        <label className="stack compact-stack">
                            <span className="muted">Delay days</span>
                            <input
                                disabled={busy || quickSaving}
                                min={0}
                                max={365}
                                type="number"
                                value={delayDays}
                                onChange={(event) => void updateDelayDays(Number(event.target.value))}
                            />
                        </label>
                    </div>
                </div>
            ) : null}
            {menuOpen && activePanel === "appearance" ? (
                <div
                    className="account-submenu account-appearance-menu floating-menu-panel"
                    style={submenuStyle(150)}
                    onMouseEnter={() => setActivePanel("appearance")}
                >
                    {([
                        ["light", "Light mode"],
                        ["dark", "Dark mode"],
                        ["system", "System"]
                    ] as Array<[ThemeMode, string]>).map(([mode, label]) => (
                        <button
                            className="appearance-option"
                            key={mode}
                            type="button"
                            onClick={() => onThemeChange(mode)}
                        >
                            <span>{label}</span>
                            {themeMode === mode ? <span aria-hidden="true">✓</span> : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function AccountAvatar({
    imageKey,
    imageVersion,
    large = false
}: {
    imageKey: string | null;
    imageVersion: number;
    large?: boolean;
}) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [imageKey, imageVersion]);

    const src = hasStoredImage(imageKey) && !imageFailed
        ? `/api/profile-image?v=${encodeURIComponent(`${imageVersion}:${imageKey}`)}`
        : null;

    return (
        <span className={`account-avatar ${large ? "large" : ""}`} aria-hidden="true">
            {src ? (
                <img
                    alt=""
                    decoding="async"
                    src={src}
                    onError={() => setImageFailed(true)}
                />
            ) : null}
        </span>
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
                    <Icon name={queueRankMode ? "cancel" : "rank"} />
                    <span>{queueRankMode ? "Stop Ranking Queue" : "Rank Queue"}</span>
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
                <EmptyState compact icon="rank" title="Queue Empty">
                    {activeSessionId
                        ? "Queue controls will return after the active ranking finishes."
                        : "Queued entries will appear here after you add them."}
                </EmptyState>
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
    const [menuPoint, setMenuPoint] = useState<{ left: number; top: number } | null>(null);
    const [name, setName] = useState(entry.name);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen, menuPoint);
    useEscapeKey(isRenaming, () => { setName(entry.name); setIsRenaming(false); });

    useEffect(() => {
        setName(entry.name);
        setIsRenaming(false);
        setMenuOpen(false);
        setMenuPoint(null);
    }, [entry.name]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(entry, name);
        setIsRenaming(false);
    }

    return (
        <div
            className={`queue-item ${isReady ? "ready" : ""}`}
            onContextMenu={(event) => {
                event.preventDefault();
                if (disabled) {
                    return;
                }
                setMenuPoint({ left: event.clientX, top: event.clientY });
                setMenuOpen(true);
            }}
        >
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
                    <div
                        title="Double-click to rename · Right-click for actions"
                        onDoubleClick={() => {
                            if (!disabled) {
                                setMenuOpen(false);
                                setName(entry.name);
                                setIsRenaming(true);
                            }
                        }}
                    >
                        <strong>{entry.name}</strong>
                        <p className="muted">{entry.categoryName} · {isReady ? "Ready" : formatDateTime(entry.availableAt)}</p>
                    </div>
                )}
            </div>
            <div className="context-menu-host" ref={menuRef}>
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
                                void onStart(entry);
                            }}
                        >
                            <MenuIconLabel icon="rank">
                                Rank Now
                            </MenuIconLabel>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                setName(entry.name);
                                setIsRenaming(true);
                            }}
                        >
                            <MenuIconLabel icon="edit">
                                Rename
                            </MenuIconLabel>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                onPickImage(entry);
                            }}
                        >
                            <MenuIconLabel icon="image">
                                {hasStoredImage(entry.imageKey) ? `Change image` : `Pick image`}
                            </MenuIconLabel>
                        </button>
                        <button
                            className="danger menu-danger"
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                void onDelete(entry);
                            }}
                        >
                            <MenuIconLabel icon="delete">Remove</MenuIconLabel>
                        </button>
                    </div>
                ) : null}
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
    canDragReorder,
    draggedEntryId,
    isDragging,
    listLocked,
    selectedCategoryId,
    onDelete,
    onDragEnd,
    onDragPreview,
    onDragStart,
    onDropEntry,
    onDropPreview,
    onPickImage,
    onRename,
    onRerank,
    onSwitch
}: {
    entry: Entry;
    categories: CategoryWithEntries[];
    canDragReorder: boolean;
    draggedEntryId: string | null;
    isDragging: boolean;
    listLocked: boolean;
    selectedCategoryId: string;
    onDelete: () => void;
    onDragEnd: () => void;
    onDragPreview: (entryId: string, targetEntryId: string, placement: DropPlacement) => void;
    onDragStart: () => void;
    onDropEntry: (entryId: string, targetEntryId: string, placement: DropPlacement) => Promise<void>;
    onDropPreview: () => void;
    onPickImage: () => void;
    onRename: (name: string) => Promise<void>;
    onRerank: () => void;
    onSwitch: (targetCategoryId: string) => void;
}) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(entry.name);
    const [targetCategoryId, setTargetCategoryId] = useState(selectedCategoryId);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPoint, setMenuPoint] = useState<{ left: number; top: number } | null>(null);
    const [moveControlsOpen, setMoveControlsOpen] = useState(false);
    const menuRef = useDismissibleMenu<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const floatingMenu = useFloatingMenu(menuOpen, menuPoint);
    useEscapeKey(isRenaming, () => { setRenameValue(entry.name); setIsRenaming(false); });

    useEffect(() => {
        setIsRenaming(false);
        setRenameValue(entry.name);
        setTargetCategoryId(selectedCategoryId);
        setMenuOpen(false);
        setMenuPoint(null);
        setMoveControlsOpen(false);
    }, [entry.name, selectedCategoryId]);

    async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(renameValue);
        setIsRenaming(false);
    }

    function dragPlacementForEvent(event: DragEvent<HTMLElement>): DropPlacement {
        const rect = event.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const horizontalIntent =
            Math.abs((event.clientX - centerX) / rect.width) >
            Math.abs((event.clientY - centerY) / rect.height);
        return horizontalIntent
            ? event.clientX > centerX ? "after" : "before"
            : event.clientY > centerY ? "after" : "before";
    }

    function setCardDragImage(event: DragEvent<HTMLElement>) {
        const card = event.currentTarget;
        const rect = card.getBoundingClientRect();
        const dragImage = card.cloneNode(true) as HTMLElement;
        dragImage.classList.remove("dragging");
        dragImage.classList.add("entry-drag-image");
        dragImage.style.width = `${rect.width}px`;
        dragImage.style.height = `${rect.height}px`;
        dragImage.style.position = "fixed";
        dragImage.style.left = "-10000px";
        dragImage.style.top = "-10000px";
        dragImage.style.pointerEvents = "none";
        dragImage.querySelector(".context-menu-host")?.remove();
        document.body.appendChild(dragImage);

        const offsetX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const offsetY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
        window.setTimeout(() => dragImage.remove(), 0);
    }

    const isEntryDraggable = canDragReorder && !isRenaming && !moveControlsOpen && !menuOpen;

    return (
        <article
            className={`entry-card ${isEntryDraggable ? "draggable" : ""} ${isDragging ? "dragging" : ""}`}
            data-entry-id={entry.id}
            draggable={isEntryDraggable}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
                if (!isEntryDraggable || !draggedEntryId || isDragging) {
                    return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onDragPreview(draggedEntryId, entry.id, dragPlacementForEvent(event));
            }}
            onDragStart={(event) => {
                if (!isEntryDraggable) {
                    event.preventDefault();
                    return;
                }

                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-goldshelf-entry-id", entry.id);
                event.dataTransfer.setData("text/plain", entry.id);
                setCardDragImage(event);
                setMenuOpen(false);
                setMoveControlsOpen(false);
                onDragStart();
            }}
            onDrop={(event) => {
                if (!isEntryDraggable) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                const droppedEntryId =
                    event.dataTransfer.getData("application/x-goldshelf-entry-id") ||
                    event.dataTransfer.getData("text/plain") ||
                    draggedEntryId;
                if (droppedEntryId && droppedEntryId !== entry.id) {
                    void onDropEntry(droppedEntryId, entry.id, dragPlacementForEvent(event));
                } else if (droppedEntryId) {
                    onDropPreview();
                } else {
                    onDragEnd();
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                setMoveControlsOpen(false);
                setMenuPoint({ left: event.clientX, top: event.clientY });
                setMenuOpen(true);
            }}
        >
            <EntryPoster entry={entry} />
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
                    <strong
                        className="entry-title"
                        title={`#${entry.rankPosition + 1} ${entry.name} · Double-click to rename · Right-click for actions${canDragReorder ? " · Drag to reorder" : ""}`}
                        onDoubleClick={() => {
                            if (!listLocked) {
                                setMenuOpen(false);
                                setMoveControlsOpen(false);
                                setRenameValue(entry.name);
                                setIsRenaming(true);
                            }
                        }}
                    >
                        #{entry.rankPosition + 1} {entry.name}
                    </strong>
                )}
                {entry.firstConsumedAt ? (
                    <div className="metric-row">
                        <span className="metric">{formatDate(entry.firstConsumedAt)}</span>
                    </div>
                ) : null}
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
            <div className="context-menu-host" ref={menuRef}>
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
                                setMenuOpen(false);
                                setMoveControlsOpen(false);
                                setRenameValue(entry.name);
                                setIsRenaming(true);
                            }}
                        >
                            <MenuIconLabel icon="edit">Rename</MenuIconLabel>
                        </button>
                        <button
                            disabled={listLocked}
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                onRerank();
                            }}
                        >
                            <MenuIconLabel icon="rerank">Rerank</MenuIconLabel>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                onPickImage();
                            }}
                        >
                            <MenuIconLabel icon="image">
                                {hasStoredImage(entry.imageKey) ? "Change Image" : "Pick Image"}
                            </MenuIconLabel>
                        </button>
                        <button
                            disabled={listLocked}
                            type="button"
                            onClick={() => {
                                setMoveControlsOpen(true);
                                setMenuOpen(false);
                            }}
                        >
                            <MenuIconLabel icon="category">Change Category</MenuIconLabel>
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
                            <MenuIconLabel icon="delete">Delete</MenuIconLabel>
                        </button>
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function EntryPoster({
    entry
}: {
    entry: Entry;
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
                    draggable={false}
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
        </div>
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
                        {session.phase === "local_repair"
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
                        {session.source === "rerank_entry"
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

function currentDateTimestamp() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(new Date(timestamp));
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
