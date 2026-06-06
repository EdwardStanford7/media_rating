import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export function useFloatingMenu(
    isOpen: boolean,
    anchorPoint: { left: number; top: number } | null = null
) {
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = useState<CSSProperties>({
        left: 0,
        position: "fixed",
        top: 0,
        visibility: "hidden"
    });

    const updatePosition = useCallback(() => {
        if (!isOpen || typeof window === "undefined") {
            return;
        }

        const panel = panelRef.current;
        if (!panel) {
            return;
        }

        const margin = 8;
        const gap = 6;
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;

        const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
        const trigger = triggerRef.current;
        if (!anchorPoint && !trigger) {
            return;
        }

        const triggerRect = trigger?.getBoundingClientRect();
        const preferredLeft = anchorPoint
            ? anchorPoint.left
            : (triggerRect?.right ?? margin) - panelWidth;
        const preferredTop = anchorPoint
            ? anchorPoint.top
            : (triggerRect?.bottom ?? margin) + gap;
        const flippedTop = anchorPoint
            ? anchorPoint.top - panelHeight
            : (triggerRect?.top ?? margin) - panelHeight - gap;

        const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
        const topCandidate =
            preferredTop + panelHeight + margin > window.innerHeight ? flippedTop : preferredTop;
        const top = Math.max(margin, Math.min(topCandidate, maxTop));

        setStyle({
            left,
            position: "fixed",
            top,
            visibility: "visible",
            zIndex: 80
        });
    }, [anchorPoint, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setStyle({
                left: 0,
                position: "fixed",
                top: 0,
                visibility: "hidden"
            });
            return;
        }

        updatePosition();
        const frameId = window.requestAnimationFrame(updatePosition);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [isOpen, updatePosition]);

    return { panelRef, style, triggerRef };
}
