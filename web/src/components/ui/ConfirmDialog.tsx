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
            className="fixed inset-0 z-60 grid place-items-center bg-modal-backdrop p-4"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                    onCancel();
                }
            }}
        >
            <section
                aria-labelledby="confirm-dialog-title"
                aria-modal="true"
                className="grid w-[min(420px,100%)] max-w-[calc(100vw-2rem)] gap-4 rounded-panel border border-line bg-panel p-4 shadow-panel [&_h2]:m-0 [&_p]:m-0"
                role="dialog"
            >
                <div>
                    <h2 id="confirm-dialog-title">{title}</h2>
                    <div className="text-muted">{children}</div>
                </div>
                <div className="grid grid-cols-2 gap-[0.6rem]">
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
