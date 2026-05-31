import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth, getEmailSignUpOptions } from "./auth";
import type { ParsedImport, StarRatingCurvePoint } from "@/lib/types";

export const getAuthOptions = createServerFn({ method: "GET" }).handler(getEmailSignUpOptions);

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
    const headers = getRequestHeaders();
    return auth.api.getSession({ headers });
});

export const loadDashboard = createServerFn({ method: "GET" })
    .handler(async () => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.loadDashboard(user.id);
    });

export const createCategory = createServerFn({ method: "POST" })
    .inputValidator((data: { name: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.createCategory(user.id, data.name);
    });

export const renameCategory = createServerFn({ method: "POST" })
    .inputValidator((data: { categoryId: string; name: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.renameCategory(user.id, data.categoryId, data.name);
    });

export const deleteCategory = createServerFn({ method: "POST" })
    .inputValidator((data: { categoryId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.deleteCategory(user.id, data.categoryId);
    });

export const createEntryWithBinaryRanking = createServerFn({ method: "POST" })
    .inputValidator(
        (data: {
            categoryId: string;
            name: string;
            firstConsumedAt: number | null;
        }) => data
    )
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.createEntryWithBinaryRanking(user.id, data);
    });

export const createQueuedEntry = createServerFn({ method: "POST" })
    .inputValidator(
        (data: {
            categoryId: string;
            name: string;
            firstConsumedAt: number | null;
        }) => data
    )
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.createQueuedEntry(user.id, data);
    });

export const updateQueueSettings = createServerFn({ method: "POST" })
    .inputValidator((data: {
        enabled: boolean;
        delayDays: number;
        promptForMissingImages: boolean;
        showStarRatings: boolean;
        starRatingCurve: StarRatingCurvePoint[];
    }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.updateQueueSettings(user.id, data);
    });

export const updateCategoryStarRatingCurve = createServerFn({ method: "POST" })
    .inputValidator((data: {
        categoryId: string;
        starRatingCurve: StarRatingCurvePoint[] | null;
    }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.updateCategoryStarRatingCurve(user.id, data);
    });

export const markImageUnavailable = createServerFn({ method: "POST" })
    .inputValidator((data: { targetKind: "entry" | "queue"; targetId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.markImageUnavailable(user.id, data);
    });

export const startQueuedEntryRanking = createServerFn({ method: "POST" })
    .inputValidator((data: { queuedEntryId: string; overrideDelay?: boolean }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.startQueuedEntryRanking(user.id, data);
    });

export const deleteQueuedEntry = createServerFn({ method: "POST" })
    .inputValidator((data: { queuedEntryId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.deleteQueuedEntry(user.id, data.queuedEntryId);
    });

export const renameQueuedEntry = createServerFn({ method: "POST" })
    .inputValidator((data: { queuedEntryId: string; name: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.renameQueuedEntry(user.id, data.queuedEntryId, data.name);
    });

export const startRerankEntry = createServerFn({ method: "POST" })
    .inputValidator((data: { entryId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.startRerankEntry(user.id, data.entryId);
    });

export const startRandomAuditRanking = createServerFn({ method: "POST" })
    .inputValidator((data: { categoryId: string; entryAId: string; entryBId: string; winnerId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.startRandomAuditRanking(user.id, data);
    });

export const moveEntryOnePosition = createServerFn({ method: "POST" })
    .inputValidator((data: { entryId: string; direction: "up" | "down" }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.moveEntryOnePosition(user.id, data);
    });

export const renameEntry = createServerFn({ method: "POST" })
    .inputValidator((data: { entryId: string; name: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.renameEntry(user.id, data.entryId, data.name);
    });

export const deleteEntry = createServerFn({ method: "POST" })
    .inputValidator((data: { entryId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.deleteEntry(user.id, data.entryId);
    });

export const switchEntryCategory = createServerFn({ method: "POST" })
    .inputValidator((data: { entryId: string; targetCategoryId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.switchEntryCategory(user.id, data);
    });

export const getBinarySession = createServerFn({ method: "GET" })
    .inputValidator((data: { sessionId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.getBinarySession(user.id, data.sessionId);
    });

export const cancelBinarySession = createServerFn({ method: "POST" })
    .inputValidator((data: { sessionId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.cancelBinarySession(user.id, data.sessionId);
    });

export const submitBinaryWinner = createServerFn({ method: "POST" })
    .inputValidator((data: { sessionId: string; winnerId: string }) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.submitBinaryWinner(user.id, data);
    });

export const importLegacyEntries = createServerFn({ method: "POST" })
    .inputValidator((data: ParsedImport) => data)
    .handler(async ({ data }) => {
        const user = await requireUser();
        const repo = await import("./repository");
        return repo.importLegacyEntries(user.id, data);
    });

async function requireUser() {
    const headers = getRequestHeaders();
    const session = await auth.api.getSession({ headers });

    if (!session?.user) {
        throw new Error("Unauthorized");
    }

    return session.user;
}
