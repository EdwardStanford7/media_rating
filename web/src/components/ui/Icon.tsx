import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconName =
    | "cancel"
    | "category"
    | "close"
    | "delete"
    | "down"
    | "edit"
    | "export"
    | "image"
    | "import"
    | "move"
    | "rank"
    | "rerank"
    | "reset"
    | "search"
    | "settings"
    | "undo"
    | "up";

const ICONS: Record<IconName, string> = {
    cancel: "×",
    category: "⇄",
    close: "×",
    delete: "⌫",
    down: "↓",
    edit: "✎",
    export: "⇡",
    image: "▣",
    import: "⇣",
    move: "⇄",
    rank: "▶",
    rerank: "↻",
    reset: "↺",
    search: "⌕",
    settings: "⚙",
    undo: "↶",
    up: "↑"
};

export function Icon({ name }: { name: IconName }) {
    return (
        <span aria-hidden="true" className="inline-grid size-[1em] flex-none place-items-center leading-none">
            {ICONS[name]}
        </span>
    );
}

export function IconButton({
    className = "",
    icon,
    label,
    size = "md",
    title,
    ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon: IconName;
    label: string;
    size?: "md" | "sm";
}) {
    return (
        <button
            {...props}
            aria-label={label}
            className={`inline-grid place-items-center p-0 text-center text-[1.05rem] ${
                size === "sm" ? "size-[1.9rem] min-w-[1.9rem]" : "size-[2.35rem] min-w-[2.35rem]"
            } ${className}`.trim()}
            title={title ?? label}
        >
            <Icon name={icon} />
        </button>
    );
}

export function MenuIconLabel({
    children,
    icon
}: {
    children: ReactNode;
    icon: IconName;
}) {
    return (
        <span className="inline-flex min-w-0 items-center gap-2">
            <Icon name={icon} />
            <span className="min-w-0 truncate">{children}</span>
        </span>
    );
}
