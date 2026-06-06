import type { DragEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { MenuIconLabel } from "@/components/Icon";
import { useDismissibleMenu } from "@/hooks/useDismissibleMenu";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFloatingMenu } from "@/hooks/useFloatingMenu";
import type { DropPlacement } from "@/lib/dragReorder";
import { formatDate } from "@/lib/format";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import type { CategoryWithEntries, Entry } from "@/lib/types";

export function EntryCard({
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
