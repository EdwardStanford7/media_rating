import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { Dashboard } from "@/components/Dashboard";
import { getAuthOptions, getSession, loadDashboard } from "@/lib/server/actions";

export const Route = createFileRoute("/")({
    head: () => ({
        links: [
            { rel: "canonical", href: "https://goldshelf.net/" }
        ]
    }),
    loader: async () => {
        const authOptions = await getAuthOptions();
        const session = await getSession();
        if (!session?.user) {
            return { session: null, dashboard: null, authOptions };
        }

        return {
            session,
            authOptions,
            dashboard: await loadDashboard()
        };
    },
    component: Home
});

function Home() {
    const { session, dashboard, authOptions } = Route.useLoaderData();

    if (!session?.user || !dashboard) {
        return <AuthPage authOptions={authOptions} />;
    }

    return (
        <Dashboard
            initialDashboard={dashboard}
            userImage={session.user.image ?? null}
            userName={session.user.name}
        />
    );
}
