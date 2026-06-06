export function dateInputToTimestamp(value: string) {
    return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

export function currentDateTimestamp() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
}

export function formatDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(new Date(timestamp));
}

export function formatDateTime(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(timestamp));
}

export function errorMessage(error: unknown) {
    if (
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError"
    ) {
        return "Image search timed out";
    }

    return error instanceof Error ? error.message : String(error);
}
