import type { ReactNode } from "react";
import { useState } from "react";
import { IconButton } from "@/components/ui/Icon";

export interface AppToast {
    id: number;
    message: string;
    variant?: "default" | "success" | "danger";
    actionLabel?: string;
    onAction?: () => Promise<void> | void;
}

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
        <div aria-live="polite" className="toast-stack">
            {children}
            {toasts.map((toast) => (
                <div className={`toast ${toast.variant ?? "default"}`} key={toast.id} role="status">
                    <span>{toast.message}</span>
                    {toast.actionLabel && toast.onAction ? (
                        <button
                            className="small-button toast-action"
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
                        className="toast-close-button"
                        icon="close"
                        label="Dismiss notification"
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                    />
                </div>
            ))}
        </div>
    );
}
