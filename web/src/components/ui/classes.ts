/*
 * Shared Tailwind class strings for small visual primitives that recur
 * across components but don't warrant their own component.
 */

/** Pill-shaped stat badge (was `.metric`). */
export const METRIC_CLASS =
    "max-w-full min-w-0 whitespace-nowrap rounded-full border border-line px-[0.45rem] py-[0.15rem] text-[0.78rem] text-muted";

/** Gold-accented inline status/notice box (was `.status`). */
export const STATUS_CLASS =
    "rounded-control border-l-4 border-l-gold bg-status px-3 py-[0.6rem] whitespace-pre-line";

/** Gradient poster base shared by entry cards and rank match choices (was `.entry-poster`/`.match-poster`). */
export const POSTER_CLASS =
    "aspect-[4/5] bg-[image:linear-gradient(135deg,var(--poster-start),var(--poster-end))] text-center text-muted";
