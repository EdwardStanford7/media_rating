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
        <span aria-hidden="true" className="button-icon">
            {ICONS[name]}
        </span>
    );
}

export function IconButton({
    className = "",
    icon,
    label,
    title,
    ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon: IconName;
    label: string;
}) {
    return (
        <button
            {...props}
            aria-label={label}
            className={`icon-button ${className}`.trim()}
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
        <span className="menu-icon-label">
            <Icon name={icon} />
            <span>{children}</span>
        </span>
    );
}
