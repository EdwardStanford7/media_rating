import { Link } from "@tanstack/react-router";
import { ArrowRight, ListOrdered, Swords, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
    {
        icon: Swords,
        title: "Rank by comparing",
        body: "Skip the impossible 1–10 scoring. Pick a winner one matchup at a time and a sorted list falls out."
    },
    {
        icon: ListOrdered,
        title: "Lists for anything",
        body: "Movies, books, games, restaurants — keep a ranked shelf for every taste you care about."
    },
    {
        icon: Users,
        title: "Share your shelf",
        body: "Make a ranking public, follow friends, and see how your favorites line up against theirs."
    }
] as const;

export function MarketingLanding() {
    return (
        <main className="grid min-h-screen content-start gap-16 bg-app px-[clamp(1rem,4vw,3rem)] py-6 text-ink">
            <header className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-[0.55rem] text-[1.35rem] font-extrabold text-gold">
                    <img
                        alt=""
                        aria-hidden="true"
                        className="h-[1.45rem] w-[1.45rem]"
                        src="/favicon.svg"
                    />
                    Goldshelf
                </span>
                <Button asChild variant="outline">
                    <Link to="/signin">Sign in</Link>
                </Button>
            </header>

            <section className="mx-auto grid w-full max-w-3xl justify-items-center gap-6 text-center">
                <h1 className="text-balance text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[0.98]">
                    Rank everything you love.
                </h1>
                <p className="max-w-xl text-balance text-lg text-muted-foreground">
                    Goldshelf turns head-to-head choices into a clean, ordered list. Build personal
                    rankings for movies, books, games, and more — one comparison at a time.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button asChild size="lg">
                        <Link to="/signin">
                            Get started<ArrowRight />
                        </Link>
                    </Button>
                    <Button asChild size="lg" variant="outline">
                        <Link to="/signin">Sign in</Link>
                    </Button>
                </div>
            </section>

            <section className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-3">
                {FEATURES.map((feature) => (
                    <div
                        className="grid content-start gap-2 rounded-panel border border-line bg-subtle-panel p-5"
                        key={feature.title}
                    >
                        <feature.icon className="size-6 text-gold" aria-hidden="true" />
                        <h2 className="text-lg font-semibold">{feature.title}</h2>
                        <p className="text-muted-foreground">{feature.body}</p>
                    </div>
                ))}
            </section>
        </main>
    );
}
