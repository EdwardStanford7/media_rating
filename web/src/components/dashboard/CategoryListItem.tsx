import type { DragEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { MenuIconLabel } from "@/components/ui/Icon";
import { useDismissibleMenu } from "@/hooks/useDismissibleMenu";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFloatingMenu } from "@/hooks/useFloatingMenu";
import type { DropPlacement } from "@/lib/dragReorder";
import type { CategoryWithEntries } from "@/lib/types";

export function CategoryListItem({
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
