import type { ReactNode } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";

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
    // Mounted only while open, so `open` is always true; Esc/Cancel close via onOpenChange.
    return (
        <AlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{children}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        variant={variant === "danger" ? "destructive" : "default"}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
