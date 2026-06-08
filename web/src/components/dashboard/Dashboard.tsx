import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DndContext,
    DragOverlay,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { Library, Search, Swords } from "lucide-react";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { BinaryRankPanel } from "@/components/ranking/BinaryRankPanel";
import { Button } from "@/components/ui/button";
import { BrandLink } from "@/components/ui/BrandLink";
import { BusyOverlay } from "@/components/ui/BusyOverlay";
import { CategoryDragOverlay, CategoryListItem } from "@/components/dashboard/CategoryListItem";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntryCard, EntryDragOverlay } from "@/components/dashboard/EntryCard";
import { ImagePickerModal } from "@/components/ranking/ImagePickerModal";
import { ImportSpreadsheetToast } from "@/components/queue/ImportSpreadsheetToast";
import { Input } from "@/components/ui/input";
import { QueuePanel } from "@/components/queue/QueuePanel";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { showActionToast, showToast, type ToastVariant } from "@/lib/toast";
import { isEditableShortcutTarget, nextPaint } from "@/lib/dom";
import {
    isReorderNoop,
    placementForSortableMove,
    type DropPlacement
} from "@/lib/dragReorder";
import { redirectIfUnauthorized } from "@/lib/errors";
import { currentDateTimestamp, dateInputToTimestamp, errorMessage, formatDateTime } from "@/lib/format";
import { shouldPromptForImage } from "@/lib/images";
import { parseLegacyWorkbook, writeExportWorkbook } from "@/lib/importExport";
import type { ImagePickerTarget } from "@/lib/posterImage";
import { orderEntries } from "@/lib/ranking";
import {
    createCategory,
    deleteCategory,
    moveCategoryRelativeToCategory,
    renameCategory
} from "@/server/categories";
import { loadDashboard } from "@/server/dashboard";
import {
    createEntryWithBinaryRanking,
    deleteEntry,
    moveEntryRelativeToEntry,
    renameEntry,
    restoreEntry,
    startRerankEntry,
    switchEntryCategory
} from "@/server/entries";
import { importLegacyEntries } from "@/server/legacyImport";
import {
    createQueuedEntry,
    deleteQueuedEntry,
    renameQueuedEntry,
    restoreQueuedEntry,
    startQueuedEntryRanking,
    updateQueueSettings
} from "@/server/queue";
import { cancelBinarySession } from "@/server/rankingSessions";
import { applyThemeMode, readInitialThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";
import type {
    BinarySessionView,
    CategoryWithEntries,
    DashboardData,
    Entry,
    QueuedEntry,
    QueueSettings
} from "@/lib/types";

interface ReversibleAction {
    id: number;
    undoToastMessage: string;
    redoToastMessage: string;
    variant?: ToastVariant;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
}

const UNDO_STACK_LIMIT = 20;

/**
 * Apply an optimistic drag ordering (a list of ids) on top of the canonical
 * items so a reorder shows immediately, before the server refresh lands. Falls
 * back to the canonical order if the id set no longer matches (e.g. after a
 * refresh adds/removes items).
 */
function applyDragOrder<T extends { id: string }>(items: T[], order: string[] | null): T[] {
    if (!order) {
        return items;
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = order
        .map((id) => byId.get(id))
        .filter((item): item is T => Boolean(item));
    return ordered.length === items.length ? ordered : items;
}

export function Dashboard({
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
    const [categoryDraftName, setCategoryDraftName] = useState("");
    const [entryDraftName, setEntryDraftName] = useState("");
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
    // `active*Id` drives the floating DragOverlay; `*DragOrder` is the optimistic
    // post-drop ordering shown until the server refresh lands.
    const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
    const [entryDragOrder, setEntryDragOrder] = useState<string[] | null>(null);
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
    const [categoryDragOrder, setCategoryDragOrder] = useState<string[] | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
    );
    const mainRef = useRef<HTMLElement | null>(null);
    const reversibleActionIdRef = useRef(0);
    const undoStackRef = useRef<ReversibleAction[]>([]);
    const redoStackRef = useRef<ReversibleAction[]>([]);

    const selectedCategory = useMemo(
        () =>
            dashboard.categories.find((category) => category.id === selectedCategoryId) ??
            dashboard.categories[0] ??
            null,
        [dashboard.categories, selectedCategoryId]
    );
    const orderedCategories = useMemo(
        () => applyDragOrder(dashboard.categories, categoryDragOrder),
        [categoryDragOrder, dashboard.categories]
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
    const orderedEntries = useMemo(
        () => applyDragOrder(displayedEntries, entryDragOrder),
        [displayedEntries, entryDragOrder]
    );
    const canDragReorderEntries = Boolean(
        selectedCategory &&
        !activeSessionId &&
        !entrySearch.trim() &&
        selectedCategory.entries.length > 1
    );
    const canDragReorderCategories = !busy && dashboard.categories.length > 1;
    const canCreateCategory = categoryDraftName.trim().length > 0;
    const canCreateEntry = entryDraftName.trim().length > 0;

    useEffect(() => {
        setActiveEntryId(null);
        setEntryDragOrder(null);
    }, [activeSessionId, entrySearch, selectedCategoryId]);

    useEffect(() => {
        if (!canDragReorderCategories) {
            setActiveCategoryId(null);
            setCategoryDragOrder(null);
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

    useEffect(() => {
        setCurrentUserName(userName);
    }, [userName]);

    useEffect(() => {
        setCurrentUserImage(userImage);
        setCurrentUserImageVersion((version) => version + 1);
    }, [userImage]);

    useEffect(() => {
        setActiveEntryId(null);
        setEntryDragOrder(null);
    }, [selectedCategoryId]);

    useEffect(() => {
        if (!canDragReorderEntries) {
            setActiveEntryId(null);
            setEntryDragOrder(null);
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

    function pushToast(toast: {
        message: string;
        variant?: ToastVariant;
        actionLabel?: string;
        onAction?: () => Promise<void> | void;
    }) {
        if (toast.actionLabel && toast.onAction) {
            showActionToast(toast.message, {
                variant: toast.variant,
                actionLabel: toast.actionLabel,
                onAction: toast.onAction
            });
        } else {
            showToast(toast.message, toast.variant);
        }
    }

    function setMessage(message: string | null, variant: ToastVariant = "default") {
        showToast(message, variant);
    }

    function setErrorMessage(error: unknown) {
        if (redirectIfUnauthorized(error)) {
            return;
        }

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
            setCategoryDraftName("");
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

    function handleCategoryDragStart(event: DragStartEvent) {
        setActiveCategoryId(String(event.active.id));
    }

    function handleCategoryDragCancel() {
        setActiveCategoryId(null);
    }

    function handleCategoryDragEnd(event: DragEndEvent) {
        setActiveCategoryId(null);
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        const ids = dashboard.categories.map((category) => category.id);
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }

        setCategoryDragOrder(arrayMove(ids, oldIndex, newIndex));
        void handleMoveCategoryRelativeToCategory(
            String(active.id),
            String(over.id),
            placementForSortableMove(oldIndex, newIndex)
        );
    }

    async function handleMoveCategoryRelativeToCategory(
        categoryId: string,
        targetCategoryId: string,
        placement: DropPlacement
    ) {
        if (categoryId === targetCategoryId) {
            setCategoryDragOrder(null);
            return;
        }

        const orderedCategoryIds = dashboard.categories.map((category) => category.id);
        const originalCategoryIndex = orderedCategoryIds.indexOf(categoryId);
        if (isReorderNoop(orderedCategoryIds, categoryId, targetCategoryId, placement)) {
            setCategoryDragOrder(null);
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
            setCategoryDragOrder(null);
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
                setEntryDraftName("");
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
            setEntryDraftName("");

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

    function handleEntryDragStart(event: DragStartEvent) {
        setActiveEntryId(String(event.active.id));
    }

    function handleEntryDragCancel() {
        setActiveEntryId(null);
    }

    function handleEntryDragEnd(event: DragEndEvent) {
        setActiveEntryId(null);
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        const ids = displayedEntries.map((entry) => entry.id);
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }

        setEntryDragOrder(arrayMove(ids, oldIndex, newIndex));
        void handleMoveEntryRelativeToEntry(
            String(active.id),
            String(over.id),
            placementForSortableMove(oldIndex, newIndex)
        );
    }

    async function handleMoveEntryRelativeToEntry(
        entryId: string,
        targetEntryId: string,
        placement: DropPlacement
    ) {
        if (entryId === targetEntryId) {
            setEntryDragOrder(null);
            return;
        }

        const orderedEntryIds = selectedCategory ? orderEntries(selectedCategory.entries).map((entry) => entry.id) : [];
        const originalEntryIndex = orderedEntryIds.indexOf(entryId);
        if (isReorderNoop(orderedEntryIds, entryId, targetEntryId, placement)) {
            setEntryDragOrder(null);
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
            setEntryDragOrder(null);
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
            const blob = await writeExportWorkbook(dashboard.categories);
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
        <main
            className="grid h-dvh min-h-screen w-full max-w-full min-w-0 grid-cols-[clamp(340px,28vw,440px)_minmax(0,1fr)] overflow-hidden max-[820px]:h-auto max-[820px]:grid-cols-1 max-[820px]:overflow-visible"
            aria-busy={busy}
        >
            {busy ? <BusyOverlay label={busyLabel ?? "Working..."} /> : null}
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
                    This permanently removes {categoryDeleteTarget.entries.length} ranked {categoryDeleteTarget.entries.length === 1 ? "entry" : "entries"},
                    {" "}
                    {dashboard.queuedEntries.filter((entry) => entry.categoryId === categoryDeleteTarget.id).length} queued {dashboard.queuedEntries.filter((entry) => entry.categoryId === categoryDeleteTarget.id).length === 1 ? "entry" : "entries"},
                    {" "}and stored images for this category.
                </ConfirmDialog>
            ) : null}
            <aside className="grid min-h-0 min-w-0 content-start gap-[1.15rem] overflow-x-hidden overflow-y-auto border-r border-border bg-sidebar p-4 max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:overflow-y-visible">
                <div className="relative flex items-center justify-between gap-3">
                    <BrandLink />
                </div>

                <form
                    className="flex flex-wrap items-center gap-[0.7rem] max-[820px]:flex-col max-[820px]:items-stretch *:max-w-full *:min-w-0"
                    onSubmit={handleCreateCategory}
                >
                    <Input
                        className="flex-[1_1_12rem]"
                        disabled={busy}
                        name="name"
                        placeholder="New category"
                        required
                        value={categoryDraftName}
                        onChange={(event) => setCategoryDraftName(event.target.value)}
                    />
                    <Button
                        size="lg"
                        disabled={busy || !canCreateCategory}
                        type="submit"
                    >
                        Add
                    </Button>
                </form>

                <DndContext
                    sensors={sensors}
                    onDragStart={handleCategoryDragStart}
                    onDragEnd={handleCategoryDragEnd}
                    onDragCancel={handleCategoryDragCancel}
                >
                    <SortableContext
                        items={orderedCategories.map((category) => category.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="m-0 grid max-h-[min(30vh,22rem)] min-h-0 min-w-0 gap-[0.45rem] overflow-x-hidden overflow-y-auto pr-[0.15rem] max-[820px]:max-h-none max-[820px]:overflow-y-visible max-[820px]:pr-0">
                            {orderedCategories.map((category) => (
                                <CategoryListItem
                                    category={category}
                                    isActive={category.id === selectedCategory?.id}
                                    key={category.id}
                                    busy={busy}
                                    canDragReorder={canDragReorderCategories}
                                    listLocked={Boolean(activeSessionId)}
                                    onDelete={() => setCategoryDeleteTarget(category)}
                                    onRename={(name) => handleRenameCategory(category.id, name)}
                                    onSelect={() => setSelectedCategoryId(category.id)}
                                />
                            ))}
                            {dashboard.categories.length === 0 ? (
                                <EmptyState
                                    compact
                                    icon={Library}
                                    title="No Categories"
                                >
                                    Add a category to start building a ranked list.
                                </EmptyState>
                            ) : null}
                        </div>
                    </SortableContext>
                    <DragOverlay>
                        {activeCategoryId
                            ? (() => {
                                const activeCategory = dashboard.categories.find(
                                    (category) => category.id === activeCategoryId
                                );
                                return activeCategory ? (
                                    <CategoryDragOverlay
                                        category={activeCategory}
                                        isActive={activeCategory.id === selectedCategory?.id}
                                    />
                                ) : null;
                            })()
                            : null}
                    </DragOverlay>
                </DndContext>

                {selectedCategory && !activeSessionId ? (
                    <div className="grid w-full justify-items-stretch gap-[0.7rem]">
                        <form className="grid max-w-full min-w-0 gap-2" onSubmit={handleCreateEntry}>
                            <Input
                                disabled={busy}
                                name="name"
                                placeholder="New entry"
                                required
                                value={entryDraftName}
                                onChange={(event) => setEntryDraftName(event.target.value)}
                            />
                            <div className="grid min-w-0 grid-cols-[minmax(10.5rem,1fr)_auto] gap-2 max-[820px]:grid-cols-1">
                                <Select
                                    defaultValue={selectedCategory.id}
                                    disabled={busy}
                                    key={selectedCategory.id}
                                    name="categoryId"
                                >
                                    <SelectTrigger aria-label="Category" className="w-full min-w-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {dashboard.categories.map((category) => (
                                                <SelectItem key={category.id} value={category.id}>
                                                    {category.name}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <Button
                                    size="lg"
                                    disabled={busy || !canCreateEntry}
                                    type="submit"
                                >
                                    Add
                                </Button>
                            </div>
                        </form>
                    </div>
                ) : null}

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

            <section
                className="grid min-h-0 min-w-0 content-start gap-[0.9rem] overflow-x-hidden overflow-y-auto px-[clamp(1rem,3vw,2.25rem)] py-5 max-[820px]:overflow-y-visible"
                ref={mainRef}
            >
                <div className="sticky top-0 z-35 -mt-1 mb-[0.35rem] flex flex-nowrap items-center gap-[0.7rem] border-b border-border bg-background pt-1 pb-[0.95rem] max-[820px]:flex-col max-[820px]:items-stretch *:max-w-full *:min-w-0">
                    <div className="grid max-w-[min(34rem,42vw)] min-w-0 flex-[0_1_auto] gap-[0.15rem]">
                        <h1 className="m-0 truncate text-2xl font-bold">{selectedCategory?.name ?? "Categories"}</h1>
                        <p className="m-0 text-muted-foreground">
                            {selectedCategory
                                ? `${displayedEntries.length}${entrySearch.trim() ? ` of ${selectedCategory.entries.length}` : ""} entries`
                                : "Create a category to start ranking."}
                        </p>
                    </div>
                    {selectedCategory && !activeSessionId ? (
                        <div className="mr-auto grid w-[min(26rem,100%)] max-w-104 min-w-0 flex-[0_1_26rem] gap-2 max-[820px]:w-full max-[820px]:max-w-none">
                            <Input
                                aria-label="Search entries"
                                value={entrySearch}
                                placeholder="Search entries"
                                onChange={(event) => setEntrySearch(event.target.value)}
                            />
                        </div>
                    ) : null}
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

                {dashboard.categories.length === 0 ? (
                    <EmptyState
                        icon={Library}
                        title="Create Your First Category"
                    >
                        Categories keep each ranked list separate. Use the sidebar form to add one.
                    </EmptyState>
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

                <DndContext
                    sensors={sensors}
                    onDragStart={handleEntryDragStart}
                    onDragEnd={handleEntryDragEnd}
                    onDragCancel={handleEntryDragCancel}
                >
                    <SortableContext
                        items={orderedEntries.map((entry) => entry.id)}
                        strategy={rectSortingStrategy}
                    >
                        <section className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-4 min-[900px]:grid-cols-[repeat(auto-fill,minmax(min(100%,440px),1fr))]">
                            {selectedCategory ? orderedEntries.map((entry) => (
                                <EntryCard
                                    entry={entry}
                                    categories={dashboard.categories}
                                    key={entry.id}
                                    canDragReorder={canDragReorderEntries}
                                    listLocked={Boolean(activeSessionId)}
                                    selectedCategoryId={selectedCategory.id}
                                    onDelete={() => handleDelete(entry)}
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
                    </SortableContext>
                    <DragOverlay>
                        {activeEntryId
                            ? (() => {
                                const activeEntry = displayedEntries.find((entry) => entry.id === activeEntryId);
                                return activeEntry ? <EntryDragOverlay entry={activeEntry} /> : null;
                            })()
                            : null}
                    </DragOverlay>
                </DndContext>
                {selectedCategory && displayedEntries.length === 0 ? (
                    <EmptyState
                        icon={entrySearch.trim() ? Search : Swords}
                        title={entrySearch.trim() ? "No Matches" : "No Entries Yet"}
                    >
                        {entrySearch.trim()
                            ? "Try a different search term or clear the search field."
                            : dashboard.queueSettings.enabled
                                ? "Add entries from the sidebar to queue them for ranking."
                                : "Add an entry from the sidebar to start ranking this category."}
                    </EmptyState>
                ) : null}
            </section>
        </main>
    );
}
