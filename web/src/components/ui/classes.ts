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

/** Accent-filled call-to-action button (was `button.primary`). */
export const PRIMARY_BUTTON_CLASS =
    "border-accent bg-accent text-on-accent enabled:hover:border-accent-strong enabled:hover:bg-accent-strong";

/** Destructive outline button (was `button.danger`). */
export const DANGER_BUTTON_CLASS = "border-danger-line text-danger";

/** Floating menu chrome shared by context menus and the account menu (was `.floating-menu-panel`). Add gap/padding per use. */
export const FLOATING_MENU_CLASS =
    "z-[80] grid max-w-[calc(100vw-1rem)] rounded-panel border border-menu-line bg-menu shadow-floating";

/** Context menu panel at default density. */
export const CONTEXT_MENU_PANEL_CLASS = `${FLOATING_MENU_CLASS} min-w-36 gap-[0.35rem] p-2`;

/** Action button inside a floating menu (was `.floating-menu-panel button`). */
export const MENU_BUTTON_CLASS = "w-full text-left enabled:hover:border-gold enabled:hover:bg-selected-panel";

/** Destructive action button inside a floating menu (was `button.danger` + its floating-menu hover). */
export const MENU_DANGER_BUTTON_CLASS =
    "w-full border-danger-line text-left text-danger enabled:hover:bg-subtle-panel";

/** Zero-size anchor hosting a context menu (was `.context-menu-host`). Pair with data-context-menu-host for DOM lookups. */
export const CONTEXT_MENU_HOST_CLASS = "absolute top-0 left-0 h-0 w-0 overflow-visible";

/** Compact button sizing (was `.small-button`). */
export const SMALL_BUTTON_CLASS = "px-[0.6rem] py-[0.35rem] text-[0.85rem]";

/** Anchor styled like a small button (was `a.small-button` + `.link-button`). */
export const LINK_BUTTON_CLASS =
    `${SMALL_BUTTON_CLASS} inline-flex items-center justify-center gap-[0.4rem] rounded-control border border-line bg-panel text-ink no-underline hover:border-accent hover:bg-selected-panel`;

/** Profile avatar circle with the two-dot silhouette gradient (was `.account-avatar`/`.profile-avatar`). Add a size-* class. */
export const AVATAR_CLASS =
    "block overflow-hidden rounded-full border border-avatar-line [background:radial-gradient(circle_at_50%_38%,var(--avatar-ink)_0_21%,transparent_22%),radial-gradient(circle_at_50%_110%,var(--avatar-ink)_0_39%,transparent_40%),var(--avatar-bg)]";

/** Full-height profile/public page shell (was `.profile-page`/`.public-profile-page`). */
export const PROFILE_PAGE_CLASS =
    "grid min-h-screen content-start gap-4 bg-app px-[clamp(1rem,3vw,2.25rem)] py-5 text-ink";

/** Centered card on a standalone page (was `.standalone-panel`). */
export const STANDALONE_PANEL_CLASS =
    "grid w-[min(100%,34rem)] gap-4 rounded-panel border border-line bg-panel p-4 shadow-panel";

/** Bordered content panel on profile pages (was `.profile-panel`/`.public-profile-header` chrome). */
export const PROFILE_PANEL_CLASS = "min-w-0 rounded-panel border border-line bg-panel p-4 shadow-panel";

/** Page header row with brand link and nav (was `.profile-page-header`). */
export const PAGE_HEADER_CLASS = "m-0 flex w-full items-center justify-between gap-4";

/** Header nav link list (was `.profile-page-nav`). */
export const PAGE_NAV_CLASS = "flex items-center gap-[0.8rem]";

/** Plain header nav link (was `.profile-page-nav a`). */
export const PAGE_NAV_LINK_CLASS = "text-ink no-underline hover:text-accent-strong";

/** Section heading with a muted counter on the right (was `.section-heading-row`/`.public-category-panel-heading`). */
export const SECTION_HEADING_CLASS =
    "mb-[0.8rem] flex items-center justify-between gap-[0.8rem] [&_h2]:m-0 [&_h2]:leading-[1.1]";
