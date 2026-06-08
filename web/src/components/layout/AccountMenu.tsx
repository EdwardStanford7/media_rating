import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { MenuIconLabel } from "@/components/ui/Icon";
import { useDismissibleMenu } from "@/hooks/useDismissibleMenu";
import { useFloatingMenu } from "@/hooks/useFloatingMenu";
import { signOut } from "@/lib/auth-client";
import { hasStoredImage } from "@/lib/images";
import type { ThemeMode } from "@/lib/theme";
import type { QueueSettings } from "@/lib/types";

// justify-between! beats the unlayered `.topbar button { justify-content: center }`
// rule; drop the important flag once the dashboard shell converts to utilities.
const MENU_ITEM_CHROME =
    "flex w-full items-center justify-between! gap-3 rounded-control border px-[0.8rem] py-[0.55rem] text-left text-ink no-underline focus-visible:border-gold focus-visible:bg-selected-panel";
const MENU_ITEM_CLASS = `${MENU_ITEM_CHROME} border-line bg-panel`;
const MENU_ITEM_LINK_CLASS = `${MENU_ITEM_CLASS} hover:border-gold hover:bg-selected-panel`;

export function AccountMenu({
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
        <div className="relative ml-auto flex-none max-[820px]:self-end" ref={menuRef}>
            <button
                aria-label="Account menu"
                aria-expanded={menuOpen}
                className="flex h-[2.35rem] w-[2.35rem] items-center justify-center rounded-full p-0"
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
                    <Link
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-line pb-3 text-ink no-underline hover:text-accent-strong"
                        to="/profile"
                        onClick={() => {
                            setMenuOpen(false);
                            clearPanel();
                        }}
                        onMouseEnter={clearPanel}
                    >
                        <AccountAvatar
                            imageKey={userImage}
                            imageVersion={userImageVersion}
                            large
                        />
                        <div>
                            <strong className="block min-w-0 truncate">{userName}</strong>
                            <span className="mt-[0.1rem] block text-[0.82rem] text-muted">Account</span>
                        </div>
                    </Link>
                    <Link
                        className={MENU_ITEM_LINK_CLASS}
                        to="/profile"
                        onClick={() => setMenuOpen(false)}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="edit">Profile</MenuIconLabel>
                    </Link>
                    <button
                        aria-expanded={activePanel === "settings"}
                        className={`${MENU_ITEM_CHROME} ${activePanel === "settings" ? "border-gold bg-selected-panel" : "border-line bg-panel"}`}
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
                        className={`${MENU_ITEM_CHROME} ${activePanel === "appearance" ? "border-gold bg-selected-panel" : "border-line bg-panel"}`}
                        type="button"
                        onClick={(event) => showPanel("appearance", event)}
                        onFocus={(event) => showPanel("appearance", event)}
                        onMouseEnter={(event) => showPanel("appearance", event)}
                    >
                        <MenuIconLabel icon="reset">Appearance</MenuIconLabel>
                        <span aria-hidden="true">›</span>
                    </button>
                    <button
                        className={MENU_ITEM_CLASS}
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
                        className={MENU_ITEM_CLASS}
                        disabled={busy}
                        type="button"
                        onClick={() => void handleExportClick()}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="export">Export xlsx</MenuIconLabel>
                    </button>
                    <button
                        className={`${MENU_ITEM_CLASS} danger menu-danger`}
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
                    <div className="flex flex-col items-start gap-[8px]">
                        <label className="flex items-center gap-[0.55rem]">
                            <input
                                checked={promptForMissingImages}
                                className="w-auto"
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("promptForMissingImages", event.target.checked)}
                            />
                            <span>Image prompts</span>
                        </label>
                        <label className="flex items-center gap-[0.55rem]">
                            <input
                                checked={enabled}
                                className="w-auto"
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("enabled", event.target.checked)}
                            />
                            <span>Queue entries</span>
                        </label>
                        <label className="grid min-w-0 content-start gap-[0.35rem]">
                            <span className="text-muted">Delay days</span>
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
                            className="flex items-center justify-between! gap-3"
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
        <span
            className={`relative block overflow-hidden rounded-full border border-avatar-line [background:radial-gradient(circle_at_50%_38%,var(--avatar-ink)_0_21%,transparent_22%),radial-gradient(circle_at_50%_110%,var(--avatar-ink)_0_39%,transparent_40%),var(--avatar-bg)] ${
                large ? "size-[2.2rem]" : "size-[1.45rem]"
            }`}
            aria-hidden="true"
        >
            {src ? (
                <img
                    alt=""
                    className="block h-full w-full rounded-[inherit] object-cover"
                    decoding="async"
                    src={src}
                    onError={() => setImageFailed(true)}
                />
            ) : null}
        </span>
    );
}
