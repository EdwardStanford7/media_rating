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
export const DEFAULT_STAR_RATING_CURVE: StarRatingCurvePoint[] = [
    { percentile: 0, stars: 5 },
    { percentile: 0.01, stars: 5 },
    { percentile: 0.05, stars: 4.9 },
    { percentile: 0.1, stars: 4.8 },
    { percentile: 0.25, stars: 4.5 },
    { percentile: 0.5, stars: 4 },
    { percentile: 0.75, stars: 3.3 },
    { percentile: 0.9, stars: 2.2 },
    { percentile: 1, stars: 1.0 }
];

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
    const combinedEntries = combinedOrder(entries);
    return new Map(
        combinedEntries.map((entry, index) => [
            entry.id,
            starRatingForCombinedRank(index, combinedEntries.length, curve)
        ])
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
            stars: Math.max(1, Math.min(5, point.stars))
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

            if (percentile < 0 || percentile > 100 || stars < 1 || stars > 5) {
                throw new Error("Star curve percentiles must be 0-100 and stars must be 1-5");
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
    return Math.round(Math.max(1, Math.min(5, stars)) * 10) / 10;
}

function formatCurveNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function selectFreeRankMatchup(
    categories: CategoryWithEntries[],
    categorySelection: string | "any",
    random: () => number = Math.random
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
    const entryA = weightedChoice(category.entries, freeRankEntryWeight, random);
    const entryB = weightedChoice(
        category.entries.filter((entry) => entry.id !== entryA.id),
        freeRankEntryWeight,
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

function freeRankEntryWeight(entry: Pick<Entry, "freeRankWins" | "freeRankLosses">) {
    return 1 / Math.sqrt(1 + matchCount(entry));
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
