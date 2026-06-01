import type {
    Entry,
    StarRatingCurvePoint
} from "./types";

export const MAX_STAR_RATING_SCALE = 100;
export const DEFAULT_STAR_RATING_CURVE: StarRatingCurvePoint[] = [
    { percentile: 0, stars: 5 },
    { percentile: 0.01, stars: 5 },
    { percentile: 0.06, stars: 4.9 },
    { percentile: 0.12, stars: 4.6 },
    { percentile: 0.25, stars: 4.2 },
    { percentile: 0.5, stars: 3.7 },
    { percentile: 0.75, stars: 3.0 },
    { percentile: 0.9, stars: 2.1 },
    { percentile: 1, stars: 1.0 }
];
const NORMAL_CURVE_PERCENTILES = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];

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

export type RandomAuditBubbleStage = "bubble_lower_up" | "bubble_higher_down";

export interface RandomAuditIndexes {
    higherIndex: number;
    lowerIndex: number;
}

export interface RandomAuditBubbleState {
    kind: "random_audit_bubble";
    stage: RandomAuditBubbleStage;
    workingOrderIds: string[];
    higherEntryId: string;
    lowerEntryId: string;
    currentComparison: BubbleRepairComparison | null;
}

export interface RandomAuditBubbleAdvanceResult {
    state: RandomAuditBubbleState;
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

export function selectRandomAuditIndexes(
    entryCount: number,
    random: () => number = Math.random
): RandomAuditIndexes | null {
    if (entryCount < 2) {
        return null;
    }

    let totalWeight = 0;
    for (let distance = 1; distance < entryCount; distance += 1) {
        totalWeight += (entryCount - distance) * auditDistanceWeight(distance);
    }

    let target = random() * totalWeight;
    let selectedDistance = 1;
    for (let distance = 1; distance < entryCount; distance += 1) {
        target -= (entryCount - distance) * auditDistanceWeight(distance);
        if (target <= 0) {
            selectedDistance = distance;
            break;
        }
    }

    const higherIndex = Math.floor(random() * (entryCount - selectedDistance));
    return {
        higherIndex,
        lowerIndex: higherIndex + selectedDistance
    };
}

function auditDistanceWeight(distance: number) {
    return 1 / Math.sqrt(distance);
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

export function startRandomAuditBubbleState(
    workingOrderIds: string[],
    higherEntryId: string,
    lowerEntryId: string
): RandomAuditBubbleState {
    if (!workingOrderIds.includes(higherEntryId)) {
        throw new Error("Higher audit entry is missing from the working order");
    }

    if (!workingOrderIds.includes(lowerEntryId)) {
        throw new Error("Lower audit entry is missing from the working order");
    }

    return {
        kind: "random_audit_bubble",
        stage: "bubble_lower_up",
        workingOrderIds: [...workingOrderIds],
        higherEntryId,
        lowerEntryId,
        currentComparison: null
    };
}

export function advanceRandomAuditBubbleState(
    state: RandomAuditBubbleState,
    comparisons: RankingComparison[]
): RandomAuditBubbleAdvanceResult {
    const next: RandomAuditBubbleState = {
        ...state,
        workingOrderIds: [...state.workingOrderIds],
        currentComparison: null
    };
    const maxSteps = Math.max(next.workingOrderIds.length * 4 + 8, 16);

    for (let step = 0; step < maxSteps; step += 1) {
        if (next.stage === "bubble_lower_up") {
            const result = auditBubbleLeftUntilStopped(next, next.lowerEntryId, comparisons);
            if (result.needsComparison) {
                return { state: next, complete: false };
            }

            next.stage = "bubble_higher_down";
            continue;
        }

        const result = auditBubbleRightUntilStopped(next, next.higherEntryId, comparisons);
        if (result.needsComparison) {
            return { state: next, complete: false };
        }

        return { state: next, complete: true };
    }

    throw new Error("Random audit repair did not converge");
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

function auditBubbleLeftUntilStopped(
    state: RandomAuditBubbleState,
    entryId: string,
    comparisons: RankingComparison[]
) {
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

function auditBubbleRightUntilStopped(
    state: RandomAuditBubbleState,
    entryId: string,
    comparisons: RankingComparison[]
) {
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

        if (winnerId === entryId) {
            return { needsComparison: false };
        }

        state.workingOrderIds[index] = nextEntryId;
        state.workingOrderIds[index + 1] = entryId;
    }
}

export function orderEntries(entries: Entry[]): Entry[] {
    return [...entries].sort((left, right) => left.rankPosition - right.rankPosition);
}

export function starRatingForRank(
    rankIndex: number,
    totalEntries: number,
    curve: StarRatingCurvePoint[] = DEFAULT_STAR_RATING_CURVE
) {
    const percentile = totalEntries <= 1 ? 0 : rankIndex / (totalEntries - 1);
    return starRatingForPercentile(percentile, curve);
}

export function starRatingForPercentile(
    topToBottomPercentile: number,
    curve: StarRatingCurvePoint[] = DEFAULT_STAR_RATING_CURVE
) {
    const normalizedCurve = normalizeStarRatingCurve(curve);
    const percentile = Math.max(0, Math.min(1, topToBottomPercentile));

    if (percentile <= normalizedCurve[0].percentile) {
        return roundStarRating(normalizedCurve[0].stars);
    }

    for (let index = 1; index < normalizedCurve.length; index += 1) {
        const left = normalizedCurve[index - 1];
        const right = normalizedCurve[index];

        if (percentile <= right.percentile) {
            const span = right.percentile - left.percentile;
            const progress = span === 0 ? 0 : (percentile - left.percentile) / span;
            return roundStarRating(left.stars + (right.stars - left.stars) * progress);
        }
    }

    return roundStarRating(normalizedCurve[normalizedCurve.length - 1].stars);
}

export function starRatingsByEntryId(
    entries: Entry[],
    curve: StarRatingCurvePoint[] = DEFAULT_STAR_RATING_CURVE
) {
    const rankedEntries = orderEntries(entries);
    return new Map(
        rankedEntries.map((entry, index) => [
            entry.id,
            starRatingForRank(index, rankedEntries.length, curve)
        ])
    );
}

export function starRatingScaleMax(curve: StarRatingCurvePoint[] = DEFAULT_STAR_RATING_CURVE) {
    const stars = normalizeStarRatingCurve(curve).map((point) => point.stars);
    return roundStarRating(Math.max(1, ...stars));
}

export function generateNormalStarRatingCurve({
    averageStars,
    maxStars,
    minStars = 1,
    withinOneStarPercent
}: {
    averageStars: number;
    maxStars: number;
    minStars?: number;
    withinOneStarPercent: number;
}) {
    const clampedMax = Math.max(1, Math.min(MAX_STAR_RATING_SCALE, maxStars));
    const clampedMin = Math.max(0, Math.min(clampedMax, minStars));
    const average = Math.max(clampedMin, Math.min(clampedMax, averageStars));
    const middleProbability = Math.max(0.05, Math.min(0.98, withinOneStarPercent / 100));
    const zForOneStar = inverseNormalCdf((middleProbability + 1) / 2);
    const standardDeviation = zForOneStar <= 0 ? 1 : 1 / zForOneStar;

    return normalizeStarRatingCurve(
        NORMAL_CURVE_PERCENTILES.map((percentile) => {
            if (percentile === 0) {
                return { percentile, stars: clampedMax };
            }

            if (percentile === 1) {
                return { percentile, stars: clampedMin };
            }

            const percentileFromBottom = 1 - percentile;
            const stars = average + inverseNormalCdf(percentileFromBottom) * standardDeviation;
            return {
                percentile,
                stars: Math.max(clampedMin, Math.min(clampedMax, stars))
            };
        })
    );
}

export function normalizeStarRatingCurve(
    curve: StarRatingCurvePoint[] | null | undefined
): StarRatingCurvePoint[] {
    const source = curve?.length ? curve : DEFAULT_STAR_RATING_CURVE;
    const normalized = source
        .filter((point) => Number.isFinite(point.percentile) && Number.isFinite(point.stars))
        .map((point) => ({
            percentile: Math.max(0, Math.min(1, point.percentile)),
            stars: Math.max(0, Math.min(MAX_STAR_RATING_SCALE, point.stars))
        }))
        .sort((left, right) => left.percentile - right.percentile);

    if (normalized.length === 0) {
        return [...DEFAULT_STAR_RATING_CURVE];
    }

    const deduped: StarRatingCurvePoint[] = [];
    for (const point of normalized) {
        const previous = deduped[deduped.length - 1];
        if (previous && previous.percentile === point.percentile) {
            previous.stars = point.stars;
        } else {
            deduped.push({ ...point });
        }
    }

    if (deduped[0].percentile > 0) {
        deduped.unshift({ percentile: 0, stars: deduped[0].stars });
    }

    if (deduped[deduped.length - 1].percentile < 1) {
        deduped.push({ percentile: 1, stars: deduped[deduped.length - 1].stars });
    }

    return deduped;
}

export function parseStarRatingCurveText(text: string): StarRatingCurvePoint[] {
    const points = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const parts = line.split(/[\s,:]+/).filter(Boolean);
            if (parts.length < 2) {
                throw new Error("Each star curve row needs a percentile and star value");
            }

            const percentile = Number(parts[0]);
            const stars = Number(parts[1]);
            if (!Number.isFinite(percentile) || !Number.isFinite(stars)) {
                throw new Error("Star curve values must be numbers");
            }

            if (
                percentile < 0 ||
                percentile > 100 ||
                stars < 0 ||
                stars > MAX_STAR_RATING_SCALE
            ) {
                throw new Error(`Star curve percentiles must be 0-100 and stars must be 0-${MAX_STAR_RATING_SCALE}`);
            }

            return { percentile: percentile / 100, stars };
        });

    if (points.length < 2) {
        throw new Error("Star curve needs at least two points");
    }

    return normalizeStarRatingCurve(points);
}

export function starRatingCurveToText(curve: StarRatingCurvePoint[] = DEFAULT_STAR_RATING_CURVE) {
    return normalizeStarRatingCurve(curve)
        .map((point) => `${formatCurveNumber(point.percentile * 100)} ${formatCurveNumber(point.stars)}`)
        .join("\n");
}

function roundStarRating(stars: number) {
    return Math.round(Math.max(0, Math.min(MAX_STAR_RATING_SCALE, stars)) * 10) / 10;
}

function inverseNormalCdf(probability: number) {
    const p = Math.max(1e-10, Math.min(1 - 1e-10, probability));
    const coefficientsA = [
        -3.969683028665376e1,
        2.209460984245205e2,
        -2.759285104469687e2,
        1.38357751867269e2,
        -3.066479806614716e1,
        2.506628277459239
    ];
    const coefficientsB = [
        -5.447609879822406e1,
        1.615858368580409e2,
        -1.556989798598866e2,
        6.680131188771972e1,
        -1.328068155288572e1
    ];
    const coefficientsC = [
        -7.784894002430293e-3,
        -3.223964580411365e-1,
        -2.400758277161838,
        -2.549732539343734,
        4.374664141464968,
        2.938163982698783
    ];
    const coefficientsD = [
        7.784695709041462e-3,
        3.224671290700398e-1,
        2.445134137142996,
        3.754408661907416
    ];
    const low = 0.02425;
    const high = 1 - low;

    if (p < low) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((coefficientsC[0] * q + coefficientsC[1]) * q + coefficientsC[2]) * q + coefficientsC[3]) * q + coefficientsC[4]) * q + coefficientsC[5]) /
            ((((coefficientsD[0] * q + coefficientsD[1]) * q + coefficientsD[2]) * q + coefficientsD[3]) * q + 1);
    }

    if (p <= high) {
        const q = p - 0.5;
        const r = q * q;
        return (((((coefficientsA[0] * r + coefficientsA[1]) * r + coefficientsA[2]) * r + coefficientsA[3]) * r + coefficientsA[4]) * r + coefficientsA[5]) * q /
            (((((coefficientsB[0] * r + coefficientsB[1]) * r + coefficientsB[2]) * r + coefficientsB[3]) * r + coefficientsB[4]) * r + 1);
    }

    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((coefficientsC[0] * q + coefficientsC[1]) * q + coefficientsC[2]) * q + coefficientsC[3]) * q + coefficientsC[4]) * q + coefficientsC[5]) /
        ((((coefficientsD[0] * q + coefficientsD[1]) * q + coefficientsD[2]) * q + coefficientsD[3]) * q + 1);
}

function formatCurveNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
