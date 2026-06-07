import type { ReactNode } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

export function ConfirmDialog({
    children,
    confirmLabel,
    title,
    variant = "default",
    onCancel,
    onConfirm
}: {
    children: ReactNode;
    confirmLabel: string;
    title: string;
    variant?: "default" | "danger";
    onCancel: () => void;
    onConfirm: () => void;
}) {
    useEscapeKey(true, onCancel);

    return (
        <div
            className="modal-backdrop"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onCancel();
                }
            }}
        >
            <section
                aria-labelledby="confirm-dialog-title"
                aria-modal="true"
                className="confirm-modal"
                role="dialog"
            >
                <div>
                    <h2 id="confirm-dialog-title">{title}</h2>
                    <div className="muted">{children}</div>
                </div>
                <div className="confirm-actions">
                    <button type="button" onClick={onCancel}>Cancel</button>
                    <button
                        className={variant === "danger" ? "danger" : "primary"}
                        type="button"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </section>
        </div>
    );
}
