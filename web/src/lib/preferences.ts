export type ThemeMode = "light" | "dark" | "system";

export interface ClientPreferences {
    showEntryPercentile: boolean;
    themeMode: ThemeMode;
}

type ClientPreferenceKey = keyof ClientPreferences;

interface ClientPreferenceDefinition<TValue> {
    defaultValue: TValue;
    legacyStorageKeys?: readonly string[];
    parse: (storedValue: string | null) => TValue | null;
    serialize: (value: TValue) => string;
    storageKey: string;
}

export const THEME_STORAGE_KEY = "goldshelf-theme";
export const LEGACY_THEME_STORAGE_KEY = "rankly-theme";

const SHOW_ENTRY_PERCENTILE_STORAGE_KEY = "goldshelf-show-entry-percentile";

const CLIENT_PREFERENCE_DEFINITIONS: {
    [K in ClientPreferenceKey]: ClientPreferenceDefinition<ClientPreferences[K]>;
} = {
    showEntryPercentile: {
        defaultValue: true,
        parse: parseBooleanPreference,
        serialize: serializeBooleanPreference,
        storageKey: SHOW_ENTRY_PERCENTILE_STORAGE_KEY
    },
    themeMode: {
        defaultValue: "system",
        legacyStorageKeys: [LEGACY_THEME_STORAGE_KEY],
        parse: parseThemeMode,
        serialize: (themeMode) => themeMode,
        storageKey: THEME_STORAGE_KEY
    }
};

export function readClientPreference<K extends ClientPreferenceKey>(key: K): ClientPreferences[K] {
    const definition = CLIENT_PREFERENCE_DEFINITIONS[key];
    if (typeof window === "undefined") {
        return definition.defaultValue;
    }

    const parsedValue = definition.parse(readStoredValue(definition.storageKey));
    if (parsedValue !== null) {
        return parsedValue;
    }

    for (const legacyStorageKey of definition.legacyStorageKeys ?? []) {
        const legacyValue = definition.parse(readStoredValue(legacyStorageKey));
        if (legacyValue !== null) {
            writeStoredValue(definition.storageKey, definition.serialize(legacyValue));
            removeStoredValue(legacyStorageKey);
            return legacyValue;
        }
    }

    return definition.defaultValue;
}

export function saveClientPreference<K extends ClientPreferenceKey>(
    key: K,
    value: ClientPreferences[K]
) {
    const definition = CLIENT_PREFERENCE_DEFINITIONS[key];
    writeStoredValue(definition.storageKey, definition.serialize(value));
}

export function readClientPreferences(): ClientPreferences {
    return {
        showEntryPercentile: readClientPreference("showEntryPercentile"),
        themeMode: readClientPreference("themeMode")
    };
}

export function saveClientPreferences(preferences: Partial<ClientPreferences>) {
    if (preferences.showEntryPercentile !== undefined) {
        saveClientPreference("showEntryPercentile", preferences.showEntryPercentile);
    }

    if (preferences.themeMode !== undefined) {
        saveClientPreference("themeMode", preferences.themeMode);
    }
}

export function readInitialShowEntryPercentile() {
    return readClientPreference("showEntryPercentile");
}

export function saveShowEntryPercentile(showEntryPercentile: boolean) {
    saveClientPreference("showEntryPercentile", showEntryPercentile);
}

function parseBooleanPreference(storedValue: string | null) {
    if (storedValue === "true") {
        return true;
    }

    if (storedValue === "false") {
        return false;
    }

    return null;
}

function serializeBooleanPreference(value: boolean) {
    return value ? "true" : "false";
}

function parseThemeMode(storedValue: string | null): ThemeMode | null {
    if (storedValue === "light" || storedValue === "dark" || storedValue === "system") {
        return storedValue;
    }

    return null;
}

function readStoredValue(storageKey: string) {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        return window.localStorage.getItem(storageKey);
    } catch {
        return null;
    }
}

function writeStoredValue(storageKey: string, value: string) {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(storageKey, value);
    } catch {
        // Display preferences should never block core app usage.
    }
}

function removeStoredValue(storageKey: string) {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.removeItem(storageKey);
    } catch {
        // Display preferences should never block core app usage.
    }
}
