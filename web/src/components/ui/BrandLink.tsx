import { Link } from "@tanstack/react-router";

/** Goldshelf home link used in the dashboard sidebar and page headers (was `.brand-link`). */
export function BrandLink() {
    return (
        <Link
            className="group inline-flex min-w-0 items-center gap-[0.55rem] rounded-sm px-[0.35rem] py-[0.25rem] text-[1.35rem] leading-[1.1] font-extrabold text-foreground no-underline transition-[background-color,color,transform] duration-150 ease-[ease] hover:bg-accent hover:text-gold-strong motion-safe:hover:-translate-y-px"
            to="/"
        >
            <img
                alt=""
                aria-hidden="true"
                className="h-[1.45rem] w-[1.45rem] flex-none [filter:drop-shadow(0_2px_6px_color-mix(in_srgb,var(--gold)_32%,transparent))]"
                src="/favicon.svg"
            />
            <span className="min-w-0 truncate text-gold group-hover:text-gold-strong">Goldshelf</span>
        </Link>
    );
}
