/// <reference types="vite/client" />

import type { ReactNode } from "react";
import {
    HeadContent,
    Outlet,
    Scripts,
    createRootRoute
} from "@tanstack/react-router";
import "../styles/global.css";

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            { name: "viewport", content: "width=device-width, initial-scale=1" },
            { name: "application-name", content: "Rankly" },
            { name: "apple-mobile-web-app-title", content: "Rankly" },
            { name: "theme-color", content: "#5748bf" },
            { title: "Rankly" }
        ],
        links: [
            { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
            { rel: "apple-touch-icon", href: "/favicon.svg" },
            { rel: "manifest", href: "/site.webmanifest" }
        ]
    }),
    component: RootComponent
});

function RootComponent() {
    return (
        <RootDocument>
            <Outlet />
        </RootDocument>
    );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}
