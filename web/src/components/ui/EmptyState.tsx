import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

export function EmptyState({
    children,
    className = "",
    compact = false,
    glyph,
    icon,
    title
}: {
    children: ReactNode;
    className?: string;
    compact?: boolean;
    title: string;
} & ({ icon: IconName; glyph?: never } | { glyph: string; icon?: never })) {
    return (
        <section
            className={`grid max-w-[42rem] grid-cols-[auto_minmax(0,1fr)] items-center rounded-panel border border-dashed border-line bg-subtle-panel ${
                compact ? "gap-[0.6rem] p-[0.7rem]" : "gap-[0.8rem] p-4"
            } ${className}`.trim()}
        >
            <div
                className={`grid place-items-center rounded-full border border-line bg-panel text-brand ${
                    compact ? "size-[1.9rem]" : "size-9"
                }`}
            >
                {icon ? <Icon name={icon} /> : glyph}
            </div>
            <div>
                <strong>{title}</strong>
                <p className="m-0 mt-[0.2rem] text-muted-foreground">{children}</p>
            </div>
        </section>
    );
}
