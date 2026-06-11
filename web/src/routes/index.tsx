import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { loadHome } from "@/server/dashboard";

export const Route = createFileRoute("/")({
    head: () => ({
        links: [
            { rel: "canonical", href: "https://goldshelf.net/" },
            { rel: "preconnect", href: "https://fonts.googleapis.com" },
            { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
            {
                rel: "stylesheet",
                href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&display=swap"
            }
        ]
    }),
    loader: () => loadHome(),
    component: Home
});

function Home() {
    const { dashboard, user } = Route.useLoaderData();

    if (!dashboard || !user) {
        return <MarketingLanding />;
    }

    return (
        <Dashboard
            initialDashboard={dashboard}
            userIsAdmin={user.isAdmin}
            userImage={user.image}
            userName={user.name}
        />
    );
}
