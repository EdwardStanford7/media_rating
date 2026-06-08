import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightLeft, GripVertical, Image as ImageIcon, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { formatDate } from "@/lib/format";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import type { CategoryWithEntries, Entry } from "@/lib/types";

const POSTER_CLASS =
    "aspect-[4/5] bg-[image:linear-gradient(135deg,var(--poster-start),var(--poster-end))] text-center text-muted-foreground";
const ENTRY_CARD_DRAGGING_CLASS =
    "border-dashed border-primary bg-accent shadow-none [&>*]:opacity-0";

export function EntryCard({
    entry,
    categories,
    canDragReorder,
    listLocked,
    selectedCategoryId,
    onDelete,
    onPickImage,
    onRename,
    onRerank,
    onSwitch
}: {
    entry: Entry;
    categories: CategoryWithEntries[];
    canDragReorder: boolean;
    listLocked: boolean;
    selectedCategoryId: string;
    onDelete: () => void;
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
    useEscapeKey(isRenaming, () => { setRenameValue(entry.name); setIsRenaming(false); });

    // The whole card is draggable (`listeners` on the article); a plain click/
    // double-click still works because MouseSensor only starts a drag after an 8px
    // move. The grip is a decorative affordance.
    const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: entry.id,
        disabled: !canDragReorder || isRenaming || moveControlsOpen || menuOpen
    });

    useEffect(() => {
        setIsRenaming(false);
        setRenameValue(entry.name);
        setTargetCategoryId(selectedCategoryId);
        setMoveControlsOpen(false);
    }, [entry.name, selectedCategoryId]);

    async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onRename(renameValue);
        setIsRenaming(false);
    }

    const showDragHandle = canDragReorder && !isRenaming && !moveControlsOpen;

    return (
        <ContextMenu onOpenChange={setMenuOpen}>
            <ContextMenuTrigger asChild>
                <article
                    ref={setNodeRef}
                    className={`relative max-w-full min-w-0 rounded-md border border-border bg-card shadow-panel transition-[border-color,box-shadow,opacity,background-color] duration-150 ease-[ease] ${
                        canDragReorder ? "cursor-grab" : ""
                    } ${
                        isDragging
                            ? ENTRY_CARD_DRAGGING_CLASS
                            : "motion-safe:hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] motion-safe:hover:shadow-floating"
                    }`.trim()}
                    data-entry-id={entry.id}
                    style={{ transform: CSS.Transform.toString(transform), transition }}
                    {...listeners}
                >
                    {showDragHandle ? (
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-2 right-2 z-10 flex items-center justify-center rounded-sm border border-overlay-button-line bg-overlay-button p-1 text-overlay-button-ink"
                        >
                            <GripVertical className="size-4" />
                        </span>
                    ) : null}
                    <EntryPoster entry={entry} />
                    <div className="grid min-w-0 gap-[0.55rem] p-[0.65rem]">
                        {isRenaming ? (
                            <form className="grid gap-[0.45rem]" onSubmit={handleRenameSubmit}>
                                <span className="text-sm text-muted-foreground">#{entry.rankPosition + 1}</span>
                                <Input
                                    autoFocus
                                    aria-label={`Rename ${entry.name}`}
                                    value={renameValue}
                                    onChange={(event) => setRenameValue(event.target.value)}
                                />
                                <div className="grid grid-cols-2 gap-[0.45rem]">
                                    <Button size="sm" type="submit">Save</Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        type="button"
                                        onClick={() => {
                                            setRenameValue(entry.name);
                                            setIsRenaming(false);
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </form>
                        ) : (
                            <strong
                                className="block truncate text-[0.95rem] leading-tight wrap-normal"
                                title={`#${entry.rankPosition + 1} ${entry.name} · Double-click to rename · Right-click for actions${canDragReorder ? " · Drag to reorder" : ""}`}
                                onDoubleClick={() => {
                                    setMoveControlsOpen(false);
                                    setRenameValue(entry.name);
                                    setIsRenaming(true);
                                }}
                            >
                                #{entry.rankPosition + 1} {entry.name}
                            </strong>
                        )}
                        {entry.firstConsumedAt ? (
                            <div className="flex min-w-0 flex-wrap gap-[0.4rem]">
                                <span className="max-w-full min-w-0 whitespace-nowrap rounded-full border border-border px-[0.4rem] py-[0.12rem] text-[0.72rem] text-muted-foreground">{formatDate(entry.firstConsumedAt)}</span>
                            </div>
                        ) : null}
                        {moveControlsOpen ? (
                            <div className="grid gap-[0.55rem] rounded-sm border border-border bg-muted p-[0.65rem]">
                                <strong>Change Category</strong>
                                <div className="grid min-w-0 grid-cols-1 gap-[0.45rem]">
                                    <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
                                        <SelectTrigger aria-label={`Move ${entry.name}`} className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {categories.map((category) => (
                                                    <SelectItem key={category.id} value={category.id}>
                                                        {category.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                    <div className="grid min-w-0 grid-cols-2 gap-[0.45rem]">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            type="button"
                                            onClick={() => setMoveControlsOpen(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={listLocked || targetCategoryId === selectedCategoryId}
                                            type="button"
                                            onClick={() => onSwitch(targetCategoryId)}
                                        >
                                            Move
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </article>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem
                    onSelect={() => {
                        setMoveControlsOpen(false);
                        setRenameValue(entry.name);
                        setIsRenaming(true);
                    }}
                >
                    <Pencil />Rename
                </ContextMenuItem>
                <ContextMenuItem disabled={listLocked} onSelect={onRerank}>
                    <RefreshCw />Rerank
                </ContextMenuItem>
                <ContextMenuItem onSelect={onPickImage}>
                    <ImageIcon />
                    {hasStoredImage(entry.imageKey) ? "Change Image" : "Pick Image"}
                </ContextMenuItem>
                <ContextMenuItem disabled={listLocked} onSelect={() => setMoveControlsOpen(true)}>
                    <ArrowRightLeft />Change Category
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" disabled={listLocked} onSelect={onDelete}>
                    <Trash2 />Delete
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function EntryDragOverlay({ entry }: { entry: Entry }) {
    return (
        <article className="relative max-w-full min-w-0 rotate-[0.5deg] cursor-grabbing rounded-md border border-border bg-card shadow-floating">
            <span className="absolute top-2 right-2 z-10 flex items-center justify-center rounded-sm border border-overlay-button-line bg-overlay-button p-1 text-overlay-button-ink">
                <GripVertical className="size-4" />
            </span>
            <EntryPoster entry={entry} />
            <div className="grid min-w-0 gap-[0.55rem] p-[0.65rem]">
                <strong className="block truncate text-[0.95rem] leading-tight wrap-normal">
                    #{entry.rankPosition + 1} {entry.name}
                </strong>
            </div>
        </article>
    );
}

export function EntryPoster({
    entry
}: {
    entry: Entry;
}) {
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [entry.id, entry.imageKey]);

    return (
        <div className="relative grid overflow-hidden rounded-t-panel">
            {hasStoredImage(entry.imageKey) && !imageFailed ? (
                <img
                    className={`${POSTER_CLASS} block h-auto w-full max-w-full object-cover [grid-area:1/1]`}
                    src={`/api/images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                <div className={`${POSTER_CLASS} grid content-center place-items-center gap-[0.35rem] p-4 [grid-area:1/1]`}>
                    <span className="text-[1rem] leading-tight">{entry.name}</span>
                    <small className="text-[0.95rem] leading-tight text-muted-foreground">{isNoImageKey(entry.imageKey) ? "No image saved" : "No image"}</small>
                </div>
            )}
        </div>
    );
}
