import { toast } from "sonner";

export type ToastVariant = "default" | "success" | "danger";

/** Auto-dismiss timeout matching the legacy toast stack. */
const TOAST_DURATION_MS = 7000;

function toastFn(variant: ToastVariant) {
    if (variant === "danger") return toast.error;
    if (variant === "success") return toast.success;
    return toast;
}

/** Show a transient notification. No-op for empty messages (legacy `setMessage(null)`). */
export function showToast(message: string | null, variant: ToastVariant = "default") {
    if (!message) {
        return;
    }
    toastFn(variant)(message, { duration: TOAST_DURATION_MS });
}

/** Show a notification with an inline action button (e.g. Undo/Redo). */
export function showActionToast(
    message: string,
    options: { variant?: ToastVariant; actionLabel: string; onAction: () => void }
) {
    toastFn(options.variant ?? "default")(message, {
        duration: TOAST_DURATION_MS,
        action: { label: options.actionLabel, onClick: options.onAction }
    });
}
