import { useSyncExternalStore } from "react";

function subscribe() {
    return () => {};
}

/**
 * Returns false during SSR and the hydration render, true after mount.
 * Use to defer timezone/locale-dependent output (e.g. local times) that
 * would otherwise mismatch the server-rendered HTML.
 */
export function useHydrated() {
    return useSyncExternalStore(
        subscribe,
        () => true,
        () => false
    );
}
