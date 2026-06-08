export type DropPlacement = "before" | "after";

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

/**
 * Translate a dnd-kit sortable drop (active dropped over a target) into the
 * backend's "move relative to a target" contract. Dropping onto an item below
 * the dragged one lands it after that item; onto one above, before it.
 */
export function placementForSortableMove(oldIndex: number, newIndex: number): DropPlacement {
    return oldIndex < newIndex ? "after" : "before";
}
