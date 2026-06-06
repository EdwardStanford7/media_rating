export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "rankly-theme";

export function readInitialThemeMode(): ThemeMode {
    if (typeof window === "undefined") {
        return "system";
    }

    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
        return savedTheme;
    }

    return "system";
}

export function saveThemeMode(themeMode: ThemeMode) {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
}

export function applyThemeMode(themeMode: ThemeMode) {
    if (typeof window === "undefined") {
        return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
        document.documentElement.dataset.theme = themeMode === "system"
            ? mediaQuery.matches ? "dark" : "light"
            : themeMode;
    };

    apply();
    if (themeMode !== "system") {
        return undefined;
    }

    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
}
