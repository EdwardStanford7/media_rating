import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { MenuIconLabel } from "@/components/ui/Icon";
import { useDismissibleMenu } from "@/hooks/useDismissibleMenu";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFloatingMenu } from "@/hooks/useFloatingMenu";
import { useHydrated } from "@/hooks/useHydrated";
import { formatDateTime } from "@/lib/format";
import { hasStoredImage, isNoImageKey } from "@/lib/images";
import type { QueuedEntry } from "@/lib/types";

export function QueuedEntryRow({
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
    // availableAt is a real instant; the server can't know the client's
    // timezone, so render UTC until hydration and local time after mount.
    const hydrated = useHydrated();
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
            className={`relative grid min-w-0 grid-cols-[54px_minmax(0,1fr)] items-start gap-[0.55rem] rounded-control border p-[0.65rem] ${
                isReady ? "border-accent bg-ready-panel" : "border-line bg-subtle-panel"
            }`}
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
            <div className="grid min-w-0 gap-[0.55rem]">
                {isRenaming ? (
                    <form className="grid gap-[0.45rem]" onSubmit={handleSubmit}>
                        <input
                            autoFocus
                            aria-label={`Rename ${entry.name}`}
                            disabled={disabled}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-[0.45rem]">
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
                        <p className="m-0 mt-[0.2rem] text-muted">{entry.categoryName} · {isReady ? "Ready" : formatDateTime(entry.availableAt, hydrated ? undefined : "UTC")}</p>
                    </div>
                )}
            </div>
            <div className="context-menu-host" ref={menuRef}>
                {menuOpen ? (
                    <div
                        className="floating-menu-panel min-w-36"
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
                className="block aspect-[4/5] h-auto w-[54px] overflow-hidden rounded-[5px] border border-line object-cover"
                src={`/api/queued-images/${entry.id}?v=${encodeURIComponent(String(entry.imageKey))}`}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImageFailed(true)}
            />
        );
    }

    return (
        <div className="grid aspect-[4/5] w-[54px] content-center place-items-center gap-[0.35rem] overflow-hidden rounded-[5px] border border-line bg-[image:linear-gradient(135deg,var(--poster-start),var(--poster-end))] text-center text-[0.8rem] text-muted">
            <span className="text-[1rem] leading-[1.25]">{entry.name}</span>
            {isNoImageKey(entry.imageKey) ? <small className="text-[0.78rem] leading-[1.25] text-muted">No image</small> : null}
        </div>
    );
}
