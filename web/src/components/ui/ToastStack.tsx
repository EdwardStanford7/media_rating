import type { ReactNode } from "react";
import { useState } from "react";
import { SMALL_BUTTON_CLASS } from "@/components/ui/classes";
import { IconButton } from "@/components/ui/Icon";

export interface AppToast {
    id: number;
    message: string;
    variant?: "default" | "success" | "danger";
    actionLabel?: string;
    onAction?: () => Promise<void> | void;
}

export const TOAST_PANEL_CLASS =
    "pointer-events-auto rounded-panel border border-line border-l-4 bg-panel p-[0.65rem] shadow-floating";

const TOAST_VARIANT_CLASS: Record<NonNullable<AppToast["variant"]>, string> = {
    default: "border-l-accent",
    success: "border-l-success",
    danger: "border-l-danger"
};

export function ToastStack({
    children,
    onDismiss,
    toasts
}: {
    children?: ReactNode;
    onDismiss: (toastId: number) => void;
    toasts: AppToast[];
}) {
    const [activeActionId, setActiveActionId] = useState<number | null>(null);

    if (toasts.length === 0 && !children) {
        return null;
    }

    return (
        <div
            aria-live="polite"
            className="pointer-events-none fixed bottom-4 left-4 z-90 grid w-[min(26rem,calc(100vw-2rem))] gap-[0.6rem]"
        >
            {children}
            {toasts.map((toast) => (
                <div
                    className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[0.6rem] ${TOAST_PANEL_CLASS} ${TOAST_VARIANT_CLASS[toast.variant ?? "default"]}`}
                    key={toast.id}
                    role="status"
                >
                    <span className="min-w-0">{toast.message}</span>
                    {toast.actionLabel && toast.onAction ? (
                        <button
                            className={`${SMALL_BUTTON_CLASS} whitespace-nowrap`}
                            disabled={activeActionId === toast.id}
                            type="button"
                            onClick={async () => {
                                setActiveActionId(toast.id);
                                try {
                                    await toast.onAction?.();
                                    onDismiss(toast.id);
                                } finally {
                                    setActiveActionId(null);
                                }
                            }}
                        >
                            {activeActionId === toast.id ? "Working..." : toast.actionLabel}
                        </button>
                    ) : null}
                    <IconButton
                        icon="close"
                        label="Dismiss notification"
                        size="sm"
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                    />
                </div>
            ))}
        </div>
    );
}
