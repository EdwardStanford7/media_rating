import type {
    CategoryWithEntries,
    DisplayMode,
    Entry,
    FreeRankMatchup,
    StarRatingCurvePoint
} from "./types";

export const DEFAULT_ELO = 1500;
export const ELO_K_FACTOR = 32;
export const EARLY_ELO_K_FACTOR = 64;
export const COMBINED_MIN_MATCHES = 10;
export const RANK_PRIOR_ELO_RANGE = 400;
export const MAX_STAR_RATING_SCALE = 100;
const FREE_RANK_MATCH_BALANCE_EXPONENT = 1;
const FREE_RANK_RANGE_TUNING_MATCHES = 30;
const FREE_RANK_EARLY_BAND_RATIO = 0.65;
const FREE_RANK_LATE_BAND_RATIO = 0.12;
const FREE_RANK_MIN_LATE_BAND = 2;
const FREE_RANK_EXPLORATION_FLOOR = 0.08;
const FREE_RANK_REPEAT_PENALTY_MULTIPLIER = 1.5;
const FREE_RANK_REPEAT_RECENCY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
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

export interface FreeRankPairHistory {
    entryAId: string;
    entryBId: string;
    matchCount: number;
    lastMatchedAt: number | null;
}

export interface FreeRankMatchupSelectionOptions {
    pairHistory?: FreeRankPairHistory[];
    now?: number;
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
    if (allowUpwardCheck && finalIndex >= 2) {
        return {
            phase: "repair_up",
            finalIndex,
            opponentIndex: finalIndex - 2,
            initialUpwardCheck: true
        };
    }

    if (finalIndex + 1 < activeEntryCount) {
        return {
            phase: "repair_down",
            finalIndex,
            opponentIndex: finalIndex + 1,
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

export function updateEloPair(
    winnerElo: number,
    loserElo: number,
    winnerKFactor = ELO_K_FACTOR,
    loserKFactor = winnerKFactor
) {
    const winnerExpected = 1 / (1 + 10 ** ((loserElo - winnerElo) / 400));
    const loserExpected = 1 / (1 + 10 ** ((winnerElo - loserElo) / 400));

    return {
        winnerElo: winnerElo + winnerKFactor * (1 - winnerExpected),
        loserElo: loserElo + loserKFactor * (0 - loserExpected)
    };
}

export function matchCount(entry: Pick<Entry, "freeRankWins" | "freeRankLosses">) {
    return entry.freeRankWins + entry.freeRankLosses;
}

export function eloKFactorForMatchCount(matches: number) {
    if (matches < 5) {
        return EARLY_ELO_K_FACTOR;
    }

    if (matches < 15) {
        return 48;
    }

    if (matches < 30) {
        return 40;
    }

    return ELO_K_FACTOR;
}

export function rankPriorElo(rankPosition: number, categorySize: number) {
    if (categorySize <= 1) {
        return DEFAULT_ELO;
    }

    const clampedRank = Math.max(0, Math.min(categorySize - 1, rankPosition));
    const topToBottomPercentile = clampedRank / (categorySize - 1);
    const centered = 1 - topToBottomPercentile * 2;
    return Math.round(DEFAULT_ELO + centered * RANK_PRIOR_ELO_RANGE);
}

export function rebaseEloForRankChange(
    currentElo: number,
    oldRankPosition: number,
    oldCategorySize: number,
    newRankPosition: number,
    newCategorySize: number
) {
    const residual = currentElo - rankPriorElo(oldRankPosition, oldCategorySize);
    return rankPriorElo(newRankPosition, newCategorySize) + residual;
}

export function orderEntries(entries: Entry[], displayMode: DisplayMode): Entry[] {
    if (displayMode === "free_rank") {
        return [...entries].sort((left, right) => {
            const eloDiff = right.freeRankElo - left.freeRankElo;
            if (eloDiff !== 0) {
                return eloDiff;
            }

            return left.rankPosition - right.rankPosition;
        });
    }

    if (displayMode === "combined") {
        return combinedOrder(entries);
    }

    return [...entries].sort((left, right) => left.rankPosition - right.rankPosition);
}

export function combinedOrder(entries: Entry[]): Entry[] {
    const binaryOrdered: Entry[] = orderEntries(entries, "ordered list");
    const maxShift = Math.min(10, Math.floor(binaryOrdered.length * 0.1));

    if (maxShift <= 0) {
        return binaryOrdered;
    }

    return binaryOrdered
        .map((entry, binaryIndex) => {
            const confidence = Math.min(matchCount(entry) / COMBINED_MIN_MATCHES, 1);
            const eloDelta = (entry.freeRankElo - rankPriorElo(binaryIndex, binaryOrdered.length)) / 400;
            const shift = Math.max(
                -maxShift,
                Math.min(maxShift, Math.round(eloDelta * maxShift * confidence))
            );

            return {
                entry,
                binaryIndex,
                combinedIndex: binaryIndex - shift
            };
        })
        .sort((left, right) => {
            if (left.combinedIndex !== right.combinedIndex) {
                return left.combinedIndex - right.combinedIndex;
            }

            return left.binaryIndex - right.binaryIndex;
        })
        .map(({ entry }) => entry);
}

export function starRatingForCombinedRank(
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
    const combinedEntries = orderEntries(entries, "ordered list");
    return new Map(
        combinedEntries.map((entry, index) => [
            entry.id,
            starRatingForCombinedRank(index, combinedEntries.length, curve)
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

export function selectFreeRankMatchup(
    categories: CategoryWithEntries[],
    categorySelection: string | "any",
    random: () => number = Math.random,
    options: FreeRankMatchupSelectionOptions = {}
): FreeRankMatchup | null {
    const eligibleCategories = categories.filter(
        (category) =>
            category.entries.length >= 2 &&
            (categorySelection === "any" || category.id === categorySelection)
    );

    if (eligibleCategories.length === 0) {
        return null;
    }

    const category = weightedChoice(
        eligibleCategories,
        (candidate) => possiblePairCount(candidate.entries.length),
        random
    );
    const freeRankIndexes = freeRankOrderedIndexes(category.entries);
    const pairHistory = pairHistoryIndex(options.pairHistory ?? []);
    const now = options.now ?? Date.now();
    const entryA = weightedChoice(category.entries, freeRankAnchorWeight, random);
    const entryB = weightedChoice(
        category.entries.filter((entry) => entry.id !== entryA.id),
        (candidate) => freeRankOpponentWeight({
            anchor: entryA,
            candidate,
            freeRankIndexes,
            pairHistory,
            now,
            categorySize: category.entries.length
        }),
        random
    );

    return {
        categoryId: category.id,
        categoryName: category.name,
        entryA,
        entryB
    };
}

function possiblePairCount(entryCount: number) {
    return entryCount * (entryCount - 1) / 2;
}

function freeRankAnchorWeight(entry: Pick<Entry, "freeRankWins" | "freeRankLosses">) {
    return freeRankMatchBalanceWeight(matchCount(entry));
}

function freeRankMatchBalanceWeight(matches: number) {
    return 1 / ((1 + matches) ** FREE_RANK_MATCH_BALANCE_EXPONENT);
}

function freeRankOpponentWeight({
    anchor,
    candidate,
    categorySize,
    freeRankIndexes,
    now,
    pairHistory
}: {
    anchor: Entry;
    candidate: Entry;
    categorySize: number;
    freeRankIndexes: Map<string, number>;
    now: number;
    pairHistory: Map<string, FreeRankPairHistory>;
}) {
    const anchorIndex = freeRankIndexes.get(anchor.id) ?? anchor.rankPosition;
    const candidateIndex = freeRankIndexes.get(candidate.id) ?? candidate.rankPosition;
    const distance = Math.abs(anchorIndex - candidateIndex);
    const band = freeRankOpponentBand(matchCount(anchor), categorySize);
    const distanceWeight = Math.exp(-(distance * distance) / (2 * band * band));
    const explorationWeight = FREE_RANK_EXPLORATION_FLOOR + distanceWeight;
    const historyPenalty = pairHistoryPenalty(
        pairHistory.get(pairKey(anchor.id, candidate.id)),
        now
    );

    return freeRankMatchBalanceWeight(matchCount(candidate)) * explorationWeight * historyPenalty;
}

function freeRankOpponentBand(anchorMatches: number, categorySize: number) {
    const confidence = Math.max(0, Math.min(anchorMatches / FREE_RANK_RANGE_TUNING_MATCHES, 1));
    const earlyBand = Math.max(1, categorySize * FREE_RANK_EARLY_BAND_RATIO);
    const lateBand = Math.max(FREE_RANK_MIN_LATE_BAND, categorySize * FREE_RANK_LATE_BAND_RATIO);
    return earlyBand + (lateBand - earlyBand) * confidence;
}

function pairHistoryPenalty(history: FreeRankPairHistory | undefined, now: number) {
    if (!history) {
        return 1;
    }

    const countPenalty = 1 / (1 + history.matchCount * FREE_RANK_REPEAT_PENALTY_MULTIPLIER);
    if (!history.lastMatchedAt) {
        return countPenalty;
    }

    const ageDays = Math.max(0, (now - history.lastMatchedAt) / DAY_MS);
    const recencyPenalty = Math.max(0.2, Math.min(ageDays / FREE_RANK_REPEAT_RECENCY_DAYS, 1));
    return Math.max(0.03, countPenalty * recencyPenalty);
}

function freeRankOrderedIndexes(entries: Entry[]) {
    const indexes = new Map<string, number>();
    [...entries]
        .sort((left, right) => {
            const eloDiff = right.freeRankElo - left.freeRankElo;
            if (eloDiff !== 0) {
                return eloDiff;
            }

            return left.rankPosition - right.rankPosition;
        })
        .forEach((entry, index) => indexes.set(entry.id, index));
    return indexes;
}

function pairHistoryIndex(history: FreeRankPairHistory[]) {
    return new Map(history.map((item) => [pairKey(item.entryAId, item.entryBId), item]));
}

function pairKey(entryAId: string, entryBId: string) {
    return entryAId < entryBId ? `${entryAId}:${entryBId}` : `${entryBId}:${entryAId}`;
}

function weightedChoice<T>(
    items: T[],
    weightFor: (item: T) => number,
    random: () => number
) {
    const weightedItems = items.map((item) => ({
        item,
        weight: Math.max(0, weightFor(item))
    }));
    const totalWeight = weightedItems.reduce((total, weightedItem) => total + weightedItem.weight, 0);

    if (totalWeight <= 0) {
        return items[Math.floor(random() * items.length)];
    }

    let target = random() * totalWeight;
    for (const weightedItem of weightedItems) {
        if (target < weightedItem.weight) {
            return weightedItem.item;
        }
        target -= weightedItem.weight;
    }

    return weightedItems[weightedItems.length - 1].item;
}
