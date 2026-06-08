import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getAuthOptions, getSession } from "@/server/session";

export const Route = createFileRoute("/signup")({
    head: () => ({
        meta: [
            { title: "Sign up · Goldshelf" }
        ],
        links: [
            { rel: "canonical", href: "https://goldshelf.net/signup" }
        ]
    }),
    beforeLoad: async () => {
        const session = await getSession();
        if (session?.user) {
            throw redirect({ to: "/" });
        }
    },
    loader: async () => ({ authOptions: await getAuthOptions() }),
    component: SignUpRoute
});

function SignUpRoute() {
    const { authOptions } = Route.useLoaderData();
    return <SignUpForm authOptions={authOptions} />;
}
