import type { BubbleRepairState, RankingComparison } from "@/lib/ranking";
import type { RankingOperationKind } from "@/lib/types";

export interface RankingOperationStateEnvelope {
    kind: "ranking_operation_state";
    comparisons: RankingComparison[];
    bubbleRepair: BubbleRepairState | null;
    queuedEntryId: string | null;
}

export function normalizeOperationKind(_value: string | null | undefined): RankingOperationKind {
    return "single";
}

export function parseRankingOperationState(value: string | null | undefined): RankingOperationStateEnvelope {
    if (!value) {
        return emptyRankingOperationState();
    }

    try {
        const parsed = JSON.parse(value) as Partial<RankingOperationStateEnvelope>;
        if (parsed.kind === "ranking_operation_state") {
            return {
                kind: "ranking_operation_state",
                comparisons: normalizeComparisonCache(parsed.comparisons),
                bubbleRepair: normalizeBubbleRepairState(parsed.bubbleRepair),
                queuedEntryId: normalizeQueuedEntryId(parsed.queuedEntryId)
            };
        }
    } catch {
        return emptyRankingOperationState();
    }

    return emptyRankingOperationState();
}

export function serializeRankingOperationState(state: RankingOperationStateEnvelope) {
    return JSON.stringify({
        kind: "ranking_operation_state",
        comparisons: state.comparisons,
        bubbleRepair: state.bubbleRepair,
        queuedEntryId: state.queuedEntryId
    });
}

export function emptyRankingOperationState(): RankingOperationStateEnvelope {
    return {
        kind: "ranking_operation_state",
        comparisons: [],
        bubbleRepair: null,
        queuedEntryId: null
    };
}

export function addCachedComparison(
    state: RankingOperationStateEnvelope,
    winnerId: string,
    loserId: string
) {
    const comparisons = state.comparisons.filter((comparison) =>
        !(
            (comparison.winnerId === winnerId && comparison.loserId === loserId) ||
            (comparison.winnerId === loserId && comparison.loserId === winnerId)
        )
    );

    return {
        ...state,
        comparisons: [{ winnerId, loserId }, ...comparisons].slice(0, 200)
    };
}

function normalizeComparisonCache(value: unknown): RankingComparison[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((comparison): comparison is RankingComparison =>
            typeof comparison === "object" &&
            comparison !== null &&
            "winnerId" in comparison &&
            "loserId" in comparison &&
            typeof comparison.winnerId === "string" &&
            typeof comparison.loserId === "string"
        )
        .map((comparison) => ({
            winnerId: comparison.winnerId,
            loserId: comparison.loserId
        }))
        .slice(0, 200);
}

function normalizeBubbleRepairState(value: unknown): BubbleRepairState | null {
    if (
        typeof value !== "object" ||
        value === null ||
        !("kind" in value) ||
        value.kind !== "bubble_repair" ||
        !("stage" in value) ||
        typeof value.stage !== "string" ||
        !("workingOrderIds" in value) ||
        !Array.isArray(value.workingOrderIds) ||
        !("insertedEntryId" in value) ||
        typeof value.insertedEntryId !== "string"
    ) {
        return null;
    }

    const currentComparison = "currentComparison" in value &&
        typeof value.currentComparison === "object" &&
        value.currentComparison !== null &&
        "entryAId" in value.currentComparison &&
        "entryBId" in value.currentComparison &&
        typeof value.currentComparison.entryAId === "string" &&
        typeof value.currentComparison.entryBId === "string"
        ? {
            entryAId: value.currentComparison.entryAId,
            entryBId: value.currentComparison.entryBId
        }
        : null;

    return {
        kind: "bubble_repair",
        stage: value.stage as BubbleRepairState["stage"],
        workingOrderIds: value.workingOrderIds.filter((id): id is string => typeof id === "string"),
        insertedEntryId: value.insertedEntryId,
        aId: "aId" in value && typeof value.aId === "string" ? value.aId : null,
        bId: "bId" in value && typeof value.bId === "string" ? value.bId : null,
        dId: "dId" in value && typeof value.dId === "string" ? value.dId : null,
        eId: "eId" in value && typeof value.eId === "string" ? value.eId : null,
        currentComparison
    };
}

function normalizeQueuedEntryId(value: unknown) {
    return typeof value === "string" && value.trim() ? value : null;
}

export function clampInsertionIndex(index: number, length: number) {
    return Math.max(0, Math.min(length, Math.floor(index)));
}
