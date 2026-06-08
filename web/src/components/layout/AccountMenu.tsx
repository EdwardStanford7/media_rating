import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AVATAR_CLASS } from "@/components/ui/classes";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { MenuIconLabel } from "@/components/ui/Icon";
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

    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    aria-label="Account menu"
                    className="ml-auto flex h-[2.35rem] w-[2.35rem] flex-none items-center justify-center rounded-full p-0 max-[820px]:self-end"
                    type="button"
                >
                    <AccountAvatar imageKey={userImage} imageVersion={userImageVersion} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-3">
                    <AccountAvatar imageKey={userImage} imageVersion={userImageVersion} large />
                    <div className="min-w-0">
                        <strong className="block min-w-0 truncate">{userName}</strong>
                        <span className="mt-[0.1rem] block text-[0.82rem] font-normal text-muted-foreground">Account</span>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link to="/profile">
                        <MenuIconLabel icon="edit">Profile</MenuIconLabel>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <MenuIconLabel icon="settings">Settings</MenuIconLabel>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                        <DropdownMenuCheckboxItem
                            checked={promptForMissingImages}
                            disabled={busy || quickSaving}
                            onCheckedChange={(value) => void updateToggle("promptForMissingImages", value)}
                            onSelect={(event) => event.preventDefault()}
                        >
                            Image prompts
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={enabled}
                            disabled={busy || quickSaving}
                            onCheckedChange={(value) => void updateToggle("enabled", value)}
                            onSelect={(event) => event.preventDefault()}
                        >
                            Queue entries
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <label className="grid gap-[0.35rem] px-2 py-1.5" onKeyDown={(event) => event.stopPropagation()}>
                            <span className="text-[0.82rem] text-muted-foreground">Delay days</span>
                            <input
                                disabled={busy || quickSaving}
                                min={0}
                                max={365}
                                type="number"
                                value={delayDays}
                                onChange={(event) => void updateDelayDays(Number(event.target.value))}
                            />
                        </label>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <MenuIconLabel icon="reset">Appearance</MenuIconLabel>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                            value={themeMode}
                            onValueChange={(value) => onThemeChange(value as ThemeMode)}
                        >
                            <DropdownMenuRadioItem value="light">Light mode</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="dark">Dark mode</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem disabled={importDisabled} onSelect={onOpenImport}>
                    <MenuIconLabel icon="import">Import xlsx</MenuIconLabel>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onSelect={() => void onExport()}>
                    <MenuIconLabel icon="export">Export xlsx</MenuIconLabel>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => void signOut().then(() => window.location.assign("/"))}
                >
                    <MenuIconLabel icon="cancel">Sign Out</MenuIconLabel>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
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
            className={`${AVATAR_CLASS} relative ${large ? "size-[2.2rem]" : "size-[1.45rem]"}`}
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
