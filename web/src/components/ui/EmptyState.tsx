import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
    children,
    className = "",
    compact = false,
    icon: Icon,
    title
}: {
    children: ReactNode;
    className?: string;
    compact?: boolean;
    icon: LucideIcon;
    title: string;
}) {
    return (
        <section
            className={`grid max-w-2xl grid-cols-[auto_minmax(0,1fr)] items-center rounded-md border border-dashed border-border bg-muted ${
                compact ? "gap-[0.6rem] p-[0.7rem]" : "gap-[0.8rem] p-4"
            } ${className}`.trim()}
        >
            <div
                className={`grid place-items-center rounded-full border border-border bg-card text-primary ${
                    compact ? "size-[1.9rem] [&_svg]:size-4" : "size-9 [&_svg]:size-5"
                }`}
            >
                <Icon />
            </div>
            <div>
                <strong>{title}</strong>
                <p className="m-0 mt-[0.2rem] text-muted-foreground">{children}</p>
            </div>
        </section>
    );
}
