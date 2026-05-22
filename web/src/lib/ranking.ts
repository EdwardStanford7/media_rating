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
  const binaryOrdered: Entry[] = orderEntries(entries, "binary");
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
