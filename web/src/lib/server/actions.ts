import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth";
import type { DisplayMode, ParsedImport } from "@/lib/types";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  return auth.api.getSession({ headers });
});

export const loadDashboard = createServerFn({ method: "GET" })
  .inputValidator((data: { displayMode?: DisplayMode } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.loadDashboard(user.id, data.displayMode ?? "binary");
  });

export const createCategory = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.createCategory(user.id, data.name);
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

export const startRerankEntry = createServerFn({ method: "POST" })
  .inputValidator((data: { entryId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.startRerankEntry(user.id, data.entryId);
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

export const submitBinaryWinner = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; winnerId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.submitBinaryWinner(user.id, data);
  });

export const getFreeRankMatchup = createServerFn({ method: "GET" })
  .inputValidator((data: { categorySelection: string | "any" }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.getFreeRankMatchup(user.id, data.categorySelection);
  });

export const submitFreeRankWinner = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      categoryId: string;
      entryAId: string;
      entryBId: string;
      winnerId: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const repo = await import("./repository");
    return repo.submitFreeRankWinner(user.id, data);
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
