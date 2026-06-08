import type { DragEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from "@/components/ui/context-menu";
import { MenuIconLabel } from "@/components/ui/Icon";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { DropPlacement } from "@/lib/dragReorder";
import type { CategoryWithEntries } from "@/lib/types";

const CATEGORY_BUTTON_DRAGGING_CLASS =
    "cursor-grabbing border-dashed border-brand bg-selected-panel shadow-none [&>*]:opacity-0";

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
    const [name, setName] = useState(category.name);
    useEscapeKey(isRenaming, () => { setName(category.name); setIsRenaming(false); });

    useEffect(() => {
        setName(category.name);
        setIsRenaming(false);
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
        dragImage.querySelector("button")?.classList.remove(...CATEGORY_BUTTON_DRAGGING_CLASS.split(" "));
        dragImage.style.opacity = "0.96";
        dragImage.style.transform = "rotate(0.5deg)";
        dragImage.style.boxShadow = "var(--floating-shadow)";
        dragImage.style.width = `${rect.width}px`;
        dragImage.style.height = `${rect.height}px`;
        dragImage.style.position = "fixed";
        dragImage.style.left = "-10000px";
        dragImage.style.top = "-10000px";
        dragImage.style.pointerEvents = "none";
        document.body.appendChild(dragImage);

        const offsetX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
        const offsetY = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
        event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
        window.setTimeout(() => dragImage.remove(), 0);
    }

    const isCategoryDraggable = canDragReorder && !isRenaming && !menuOpen;

    if (isRenaming) {
        return (
            <form className="grid gap-[0.45rem] rounded-control border border-line bg-subtle-panel p-[0.55rem]" onSubmit={handleSubmit}>
                <input
                    autoFocus
                    aria-label={`Rename ${category.name}`}
                    disabled={busy}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
                <div className="grid grid-cols-2 gap-[0.45rem]">
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
        <ContextMenu onOpenChange={setMenuOpen}>
            <ContextMenuTrigger asChild disabled={busy}>
                <div
            className={`relative grid min-w-0 grid-cols-[minmax(0,1fr)] ${isCategoryDraggable ? "cursor-grab" : ""}`.trim()}
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
        >
            <button
                className={`min-w-0 text-left ${
                    isDragging
                        ? CATEGORY_BUTTON_DRAGGING_CLASS
                        : isActive
                            ? "border-gold bg-selected-panel shadow-[inset_3px_0_0_var(--gold)]"
                            : ""
                } ${isCategoryDraggable && !isDragging ? "cursor-grab" : ""}`.trim()}
                disabled={busy}
                title="Double-click to rename · Right-click for actions"
                type="button"
                onClick={onSelect}
                onDoubleClick={() => {
                    if (!busy) {
                        setName(category.name);
                        setIsRenaming(true);
                    }
                }}
            >
                <strong>{category.name}</strong>
                <span className="text-muted-foreground"> · {category.entries.length}</span>
            </button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem
                    onSelect={() => {
                        setName(category.name);
                        setIsRenaming(true);
                    }}
                >
                    <MenuIconLabel icon="edit">Rename</MenuIconLabel>
                </ContextMenuItem>
                <ContextMenuItem
                    variant="destructive"
                    disabled={busy || listLocked}
                    onSelect={onDelete}
                >
                    <MenuIconLabel icon="delete">Delete</MenuIconLabel>
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
