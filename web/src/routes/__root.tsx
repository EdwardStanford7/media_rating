/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { useEffect } from "react";
import {
    HeadContent,
    Outlet,
    Scripts,
    createRootRoute
} from "@tanstack/react-router";
import { applyThemeMode, readInitialThemeMode } from "@/lib/theme";
import "../styles/global.css";

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            { name: "viewport", content: "width=device-width, initial-scale=1" },
            { name: "application-name", content: "Goldshelf" },
            { name: "apple-mobile-web-app-title", content: "Goldshelf" },
            { name: "theme-color", content: "#1a1330" },
            { title: "Goldshelf" }
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
    useEffect(() => {
        return applyThemeMode(readInitialThemeMode());
    }, []);

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
