import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

export function EmptyState({
    children,
    compact = false,
    icon,
    title
}: {
    children: ReactNode;
    compact?: boolean;
    icon: IconName;
    title: string;
}) {
    return (
        <section className={`empty-state ${compact ? "compact" : ""}`}>
            <div className="empty-state-icon">
                <Icon name={icon} />
            </div>
            <div>
                <strong>{title}</strong>
                <p className="muted">{children}</p>
            </div>
        </section>
    );
}
