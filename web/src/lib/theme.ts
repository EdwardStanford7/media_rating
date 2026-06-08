export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "goldshelf-theme";
const LEGACY_THEME_STORAGE_KEY = "rankly-theme";

export function readInitialThemeMode(): ThemeMode {
    if (typeof window === "undefined") {
        return "system";
    }

    const savedTheme =
        window.localStorage.getItem(THEME_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
        window.localStorage.setItem(THEME_STORAGE_KEY, savedTheme);
        window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
        return savedTheme;
    }

    return "system";
}

// Blocking script injected into the document <head> so the correct theme class
// is set before first paint, avoiding a flash of the wrong theme on load. Mirrors
// the logic in readInitialThemeMode/applyThemeMode; keep the two in sync.
export const themeInitScript = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
)})||localStorage.getItem(${JSON.stringify(
    LEGACY_THEME_STORAGE_KEY
)});if(s!=="light"&&s!=="dark"&&s!=="system")s="system";var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

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
        const isDark = themeMode === "system" ? mediaQuery.matches : themeMode === "dark";
        document.documentElement.classList.toggle("dark", isDark);
    };

    apply();
    if (themeMode !== "system") {
        return undefined;
    }

    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
}
