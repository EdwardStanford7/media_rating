import type {
    CategoryWithEntries,
    DisplayMode,
    Entry,
    FreeRankMatchup
} from "./types";

export const DEFAULT_ELO = 1500;
export const ELO_K_FACTOR = 32;
export const COMBINED_MIN_MATCHES = 10;

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
    kFactor = ELO_K_FACTOR
) {
    const winnerExpected = 1 / (1 + 10 ** ((loserElo - winnerElo) / 400));
    const loserExpected = 1 / (1 + 10 ** ((winnerElo - loserElo) / 400));

    return {
        winnerElo: winnerElo + kFactor * (1 - winnerExpected),
        loserElo: loserElo + kFactor * (0 - loserExpected)
    };
}

export function matchCount(entry: Pick<Entry, "freeRankWins" | "freeRankLosses">) {
    return entry.freeRankWins + entry.freeRankLosses;
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
            const eloDelta = (entry.freeRankElo - DEFAULT_ELO) / 400;
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

export function starRatingForCombinedRank(rankIndex: number, totalEntries: number) {
    if (totalEntries <= 1 || rankIndex <= 0) {
        return 5;
    }

    if (rankIndex >= totalEntries - 1) {
        return 1;
    }

    const edgeProbability = 0.5 / totalEntries;
    const upperProbability = 1 - edgeProbability;
    const percentile = Math.max(
        edgeProbability,
        Math.min(upperProbability, 1 - rankIndex / (totalEntries - 1))
    );
    const edgeZ = inverseNormalCdf(upperProbability);
    const zScore = inverseNormalCdf(percentile);
    const stars = 3 + (zScore / edgeZ) * 2;

    return Math.round(Math.max(1, Math.min(5, stars)) * 10) / 10;
}

export function starRatingsByEntryId(entries: Entry[]) {
    const combinedEntries = combinedOrder(entries);
    return new Map(
        combinedEntries.map((entry, index) => [
            entry.id,
            starRatingForCombinedRank(index, combinedEntries.length)
        ])
    );
}

function inverseNormalCdf(probability: number) {
    let lower = -8;
    let upper = 8;

    for (let index = 0; index < 60; index += 1) {
        const midpoint = (lower + upper) / 2;
        if (normalCdf(midpoint) < probability) {
            lower = midpoint;
        } else {
            upper = midpoint;
        }
    }

    return (lower + upper) / 2;
}

function normalCdf(value: number) {
    return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const y =
        1 -
        (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
            0.254829592) *
            t *
            Math.exp(-x * x);

    return sign * y;
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

    const category =
        eligibleCategories[Math.floor(random() * eligibleCategories.length)];
    const firstIndex = Math.floor(random() * category.entries.length);
    let secondIndex = Math.floor(random() * (category.entries.length - 1));

    if (secondIndex >= firstIndex) {
        secondIndex += 1;
    }

    return {
        categoryId: category.id,
        categoryName: category.name,
        entryA: category.entries[firstIndex],
        entryB: category.entries[secondIndex]
    };
}
