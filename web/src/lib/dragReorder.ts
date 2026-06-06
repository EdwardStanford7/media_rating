import type { CategoryWithEntries, Entry } from "@/lib/types";

export type DropPlacement = "before" | "after";

export interface EntryDragPreview {
    draggedEntryId: string;
    targetEntryId: string;
    placement: DropPlacement;
}

export interface CategoryDragPreview {
    draggedCategoryId: string;
    targetCategoryId: string;
    placement: DropPlacement;
}

export function isReorderNoop(
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

export function previewEntryReorder(entries: Entry[], preview: EntryDragPreview | null) {
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

export function previewCategoryReorder(categories: CategoryWithEntries[], preview: CategoryDragPreview | null) {
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
