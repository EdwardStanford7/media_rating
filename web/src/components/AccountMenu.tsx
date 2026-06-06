import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { MenuIconLabel } from "@/components/Icon";
import { useDismissibleMenu } from "@/hooks/useDismissibleMenu";
import { useFloatingMenu } from "@/hooks/useFloatingMenu";
import { signOut } from "@/lib/auth-client";
import { hasStoredImage } from "@/lib/images";
import type { ThemeMode } from "@/lib/theme";
import type { QueueSettings } from "@/lib/types";

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
        <div className="account-menu" ref={menuRef}>
            <button
                aria-label="Account menu"
                aria-expanded={menuOpen}
                className="account-menu-toggle"
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
                        className="account-menu-header account-menu-header-link"
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
                            <strong className="account-display-name">{userName}</strong>
                            <span className="muted">Account</span>
                        </div>
                    </Link>
                    <Link
                        className="account-menu-item"
                        to="/profile"
                        onClick={() => setMenuOpen(false)}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="edit">Profile</MenuIconLabel>
                    </Link>
                    <button
                        aria-expanded={activePanel === "settings"}
                        className={`account-menu-item has-flyout ${activePanel === "settings" ? "active" : ""}`}
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
                        className={`account-menu-item has-flyout ${activePanel === "appearance" ? "active" : ""}`}
                        type="button"
                        onClick={(event) => showPanel("appearance", event)}
                        onFocus={(event) => showPanel("appearance", event)}
                        onMouseEnter={(event) => showPanel("appearance", event)}
                    >
                        <MenuIconLabel icon="reset">Appearance</MenuIconLabel>
                        <span aria-hidden="true">›</span>
                    </button>
                    <button
                        className="account-menu-item"
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
                        className="account-menu-item"
                        disabled={busy}
                        type="button"
                        onClick={() => void handleExportClick()}
                        onMouseEnter={clearPanel}
                    >
                        <MenuIconLabel icon="export">Export xlsx</MenuIconLabel>
                    </button>
                    <button
                        className="account-menu-item danger menu-danger"
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
                    <div
                        className="settings-toggle-grid"
                        style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}
                    >
                        <label className="checkbox-row">
                            <input
                                checked={promptForMissingImages}
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("promptForMissingImages", event.target.checked)}
                            />
                            <span>Image prompts</span>
                        </label>
                        <label className="checkbox-row">
                            <input
                                checked={enabled}
                                disabled={busy || quickSaving}
                                type="checkbox"
                                onChange={(event) => void updateToggle("enabled", event.target.checked)}
                            />
                            <span>Queue entries</span>
                        </label>
                        <label className="stack compact-stack">
                            <span className="muted">Delay days</span>
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
                            className="appearance-option"
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
        <span className={`account-avatar ${large ? "large" : ""}`} aria-hidden="true">
            {src ? (
                <img
                    alt=""
                    decoding="async"
                    src={src}
                    onError={() => setImageFailed(true)}
                />
            ) : null}
        </span>
    );
}
