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
                        <p className="muted">{entry.categoryName} · {isReady ? "Ready" : formatDateTime(entry.availableAt, hydrated ? undefined : "UTC")}</p>
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
