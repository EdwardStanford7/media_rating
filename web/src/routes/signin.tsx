import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/AuthPage";
import { getAuthOptions, getSession } from "@/server/session";

export const Route = createFileRoute("/signin")({
    head: () => ({
        meta: [
            { title: "Sign in · Goldshelf" }
        ],
        links: [
            { rel: "canonical", href: "https://goldshelf.net/signin" }
        ]
    }),
    beforeLoad: async () => {
        const session = await getSession();
        if (session?.user) {
            throw redirect({ to: "/" });
        }
    },
    loader: async () => ({ authOptions: await getAuthOptions() }),
    component: SignInRoute
});

function SignInRoute() {
    const { authOptions } = Route.useLoaderData();
    return <AuthPage authOptions={authOptions} />;
}
