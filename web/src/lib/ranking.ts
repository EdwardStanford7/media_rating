import type { Entry } from "./types";

export interface BinaryComparison {
    opponentIndex: number;
    entryWon: boolean;
}

export interface BinaryState {
    lowerBound: number;
    upperBound: number;
    pivotIndex: number;
    comparisons: BinaryComparison[];
}

export interface BinaryStepResult {
    state: BinaryState;
    complete: boolean;
    finalIndex: number | null;
}

export interface LocalRepairState {
    phase: "repair_up" | "repair_down";
    finalIndex: number;
    opponentIndex: number;
    initialUpwardCheck: boolean;
}

export interface LocalRepairStepResult {
    state: LocalRepairState | null;
    complete: boolean;
    finalIndex: number;
}

export interface RankingComparison {
    winnerId: string;
    loserId: string;
}

export type BubbleRepairStage =
    | "left_check"
    | "bubble_b_left"
    | "bubble_c_left"
    | "bubble_a_right"
    | "right_check"
    | "bubble_d_right"
    | "bubble_c_right"
    | "bubble_e_left";

export interface BubbleRepairComparison {
    entryAId: string;
    entryBId: string;
}

export interface BubbleRepairState {
    kind: "bubble_repair";
    stage: BubbleRepairStage;
    workingOrderIds: string[];
    insertedEntryId: string;
    aId: string | null;
    bId: string | null;
    dId: string | null;
    eId: string | null;
    currentComparison: BubbleRepairComparison | null;
}

export interface BubbleRepairAdvanceResult {
    state: BubbleRepairState;
    complete: boolean;
}

export function chooseBinaryPivot(
    lowerBound: number,
    upperBound: number,
    random: () => number = Math.random
) {
    if (lowerBound >= upperBound) {
        return lowerBound;
    }

    const rangeLength = upperBound - lowerBound;
    if (rangeLength <= 2) {
        return lowerBound + Math.floor(random() * rangeLength);
    }

    const midpoint = lowerBound + Math.floor(rangeLength / 2);
    const jitter = Math.max(Math.floor(rangeLength / 4), 1);
    const start = Math.max(lowerBound, midpoint - jitter);
    const end = Math.min(upperBound, midpoint + jitter + 1);
    return start + Math.floor(random() * (end - start));
}

export function startBinaryState(
    opponentCount: number,
    random: () => number = Math.random
): BinaryState | null {
    if (opponentCount <= 0) {
        return null;
    }

    return {
        lowerBound: 0,
        upperBound: opponentCount,
        pivotIndex: chooseBinaryPivot(0, opponentCount, random),
        comparisons: []
    };
}

export function recordBinaryChoice(
    state: BinaryState,
    entryWon: boolean,
    random: () => number = Math.random
): BinaryStepResult {
    const comparisons = [
        ...state.comparisons,
        { opponentIndex: state.pivotIndex, entryWon }
    ];
    const lowerBound = entryWon
        ? state.lowerBound
        : state.pivotIndex + 1;
    const upperBound = entryWon
        ? state.pivotIndex
        : state.upperBound;

    if (lowerBound < upperBound) {
        return {
            state: {
                lowerBound,
                upperBound,
                pivotIndex: chooseBinaryPivot(lowerBound, upperBound, random),
                comparisons
            },
            complete: false,
            finalIndex: null
        };
    }

    return {
        state: {
            lowerBound,
            upperBound,
            pivotIndex: lowerBound,
            comparisons
        },
        complete: true,
        finalIndex: lowerBound
    };
}

export function startLocalRepairState(
    finalIndex: number,
    activeEntryCount: number,
    allowUpwardCheck = true
): LocalRepairState | null {
    if (allowUpwardCheck && finalIndex >= 1) {
        return {
            phase: "repair_up",
            finalIndex,
            opponentIndex: finalIndex - 1,
            initialUpwardCheck: true
        };
    }

    if (finalIndex < activeEntryCount) {
        return {
            phase: "repair_down",
            finalIndex,
            opponentIndex: finalIndex,
            initialUpwardCheck: false
        };
    }

    return null;
}

export function recordLocalRepairChoice(
    state: LocalRepairState,
    subjectWon: boolean,
    activeEntryCount: number
): LocalRepairStepResult {
    if (state.phase === "repair_up") {
        if (subjectWon) {
            const finalIndex = state.opponentIndex;
            const nextOpponentIndex = finalIndex - 1;
            return nextOpponentIndex >= 0
                ? {
                    state: {
                        phase: "repair_up",
                        finalIndex,
                        opponentIndex: nextOpponentIndex,
                        initialUpwardCheck: false
                    },
                    complete: false,
                    finalIndex
                }
                : { state: null, complete: true, finalIndex };
        }

        if (state.initialUpwardCheck) {
            const nextState = startLocalRepairState(state.finalIndex, activeEntryCount, false);
            return nextState
                ? { state: nextState, complete: false, finalIndex: state.finalIndex }
                : { state: null, complete: true, finalIndex: state.finalIndex };
        }

        return { state: null, complete: true, finalIndex: state.finalIndex };
    }

    if (!subjectWon) {
        const finalIndex = state.opponentIndex + 1;
        const nextOpponentIndex = finalIndex;
        return nextOpponentIndex < activeEntryCount
            ? {
                state: {
                    phase: "repair_down",
                    finalIndex,
                    opponentIndex: nextOpponentIndex,
                    initialUpwardCheck: false
                },
                complete: false,
                finalIndex
            }
            : { state: null, complete: true, finalIndex };
    }

    return { state: null, complete: true, finalIndex: state.finalIndex };
}

export function startBubbleRepairState(
    workingOrderIds: string[],
    insertedEntryId: string
): BubbleRepairState {
    const insertedIndex = workingOrderIds.indexOf(insertedEntryId);
    if (insertedIndex < 0) {
        throw new Error("Inserted entry is missing from the working order");
    }

    return {
        kind: "bubble_repair",
        stage: "left_check",
        workingOrderIds: [...workingOrderIds],
        insertedEntryId,
        aId: workingOrderIds[insertedIndex - 2] ?? null,
        bId: workingOrderIds[insertedIndex - 1] ?? null,
        dId: workingOrderIds[insertedIndex + 1] ?? null,
        eId: workingOrderIds[insertedIndex + 2] ?? null,
        currentComparison: null
    };
}

export function advanceBubbleRepairState(
    state: BubbleRepairState,
    comparisons: RankingComparison[]
): BubbleRepairAdvanceResult {
    const next: BubbleRepairState = {
        ...state,
        workingOrderIds: [...state.workingOrderIds],
        currentComparison: null
    };
    const maxSteps = Math.max(next.workingOrderIds.length * 8 + 16, 32);

    for (let step = 0; step < maxSteps; step += 1) {
        if (next.stage === "left_check") {
            if (!next.aId) {
                next.stage = "right_check";
                continue;
            }

            const winnerId = getCachedWinner(comparisons, next.insertedEntryId, next.aId);
            if (!winnerId) {
                next.currentComparison = {
                    entryAId: next.insertedEntryId,
                    entryBId: next.aId
                };
                return { state: next, complete: false };
            }

            next.stage = winnerId === next.insertedEntryId
                ? "bubble_b_left"
                : "right_check";
            continue;
        }

        if (next.stage === "bubble_b_left") {
            const result = bubbleLeftUntilStopped(next, next.bId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }
            next.stage = "bubble_c_left";
            continue;
        }

        if (next.stage === "bubble_c_left") {
            const result = bubbleLeftUntilStopped(next, next.insertedEntryId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }
            next.stage = "bubble_a_right";
            continue;
        }

        if (next.stage === "bubble_a_right") {
            const result = bubbleRightUntilStopped(next, next.aId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }
            return { state: next, complete: true };
        }

        if (next.stage === "right_check") {
            if (!next.eId) {
                return { state: next, complete: true };
            }

            const winnerId = getCachedWinner(comparisons, next.insertedEntryId, next.eId);
            if (!winnerId) {
                next.currentComparison = {
                    entryAId: next.insertedEntryId,
                    entryBId: next.eId
                };
                return { state: next, complete: false };
            }

            if (winnerId === next.eId) {
                next.stage = "bubble_d_right";
                continue;
            }

            return { state: next, complete: true };
        }

        if (next.stage === "bubble_d_right") {
            const result = bubbleRightUntilStopped(next, next.dId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }
            next.stage = "bubble_c_right";
            continue;
        }

        if (next.stage === "bubble_c_right") {
            const result = bubbleRightUntilStopped(next, next.insertedEntryId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }
            next.stage = "bubble_e_left";
            continue;
        }

        const result = bubbleLeftUntilStopped(next, next.eId, comparisons);
        if (result.needsComparison) {
            return { state: next, complete: false };
        }
        return { state: next, complete: true };
    }

    throw new Error("Bubble repair did not converge");
}

export function getCachedWinner(
    comparisons: RankingComparison[],
    entryAId: string,
    entryBId: string
) {
    const comparison = comparisons.find((candidate) =>
        (candidate.winnerId === entryAId && candidate.loserId === entryBId) ||
        (candidate.winnerId === entryBId && candidate.loserId === entryAId)
    );

    return comparison?.winnerId ?? null;
}

function bubbleLeftUntilStopped(
    state: BubbleRepairState,
    entryId: string | null,
    comparisons: RankingComparison[]
) {
    if (!entryId) {
        return { needsComparison: false };
    }

    while (true) {
        const index = state.workingOrderIds.indexOf(entryId);
        if (index <= 0) {
            return { needsComparison: false };
        }

        const previousEntryId = state.workingOrderIds[index - 1];
        const winnerId = getCachedWinner(comparisons, entryId, previousEntryId);
        if (!winnerId) {
            state.currentComparison = {
                entryAId: entryId,
                entryBId: previousEntryId
            };
            return { needsComparison: true };
        }

        if (winnerId !== entryId) {
            return { needsComparison: false };
        }

        state.workingOrderIds[index - 1] = entryId;
        state.workingOrderIds[index] = previousEntryId;
    }
}

function bubbleRightUntilStopped(
    state: BubbleRepairState,
    entryId: string | null,
    comparisons: RankingComparison[]
) {
    if (!entryId) {
        return { needsComparison: false };
    }

    while (true) {
        const index = state.workingOrderIds.indexOf(entryId);
        if (index < 0 || index >= state.workingOrderIds.length - 1) {
            return { needsComparison: false };
        }

        const nextEntryId = state.workingOrderIds[index + 1];
        const winnerId = getCachedWinner(comparisons, entryId, nextEntryId);
        if (!winnerId) {
            state.currentComparison = {
                entryAId: entryId,
                entryBId: nextEntryId
            };
            return { needsComparison: true };
        }

        if (winnerId !== nextEntryId) {
            return { needsComparison: false };
        }

        state.workingOrderIds[index] = nextEntryId;
        state.workingOrderIds[index + 1] = entryId;
    }
}

export function orderEntries(entries: Entry[]): Entry[] {
    return [...entries].sort((left, right) => left.rankPosition - right.rankPosition);
}
