import { createRouter } from "@tanstack/react-router";
import { DefaultErrorComponent, DefaultNotFound } from "@/components/layout/RouteFallback";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
    return createRouter({
        routeTree,
        scrollRestoration: true,
        defaultPreload: "intent",
        defaultNotFoundComponent: DefaultNotFound,
        defaultErrorComponent: DefaultErrorComponent
    });
}

declare module "@tanstack/react-router" {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
