import { useEffect, useRef } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

export function useDismissibleMenu<T extends HTMLElement>(isOpen: boolean, onDismiss: () => void) {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        function handlePointerDown(event: PointerEvent) {
            const element = ref.current;
            const target = event.target;
            if (!element || !(target instanceof Node) || element.contains(target)) {
                return;
            }

            onDismiss();
        }

        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [isOpen, onDismiss]);

    useEscapeKey(isOpen, onDismiss);

    return ref;
}
