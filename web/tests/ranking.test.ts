import { describe, expect, it } from "vitest";
import {
    chooseBinaryPivot,
    combinedOrder,
    eloKFactorForMatchCount,
    parseStarRatingCurveText,
    rankPriorElo,
    recordBinaryChoice,
    rebaseEloForRankChange,
    selectFreeRankMatchup,
    startBinaryState,
    starRatingForCombinedRank,
    starRatingScaleMax,
    starRatingsByEntryId,
    updateEloPair
} from "../src/lib/ranking";
import type { CategoryWithEntries, Entry } from "../src/lib/types";

describe("pure binary ranking", () => {
    it("places a new entry at the top", () => {
        let state = startBinaryState(4, () => 0.5);
        expect(state).not.toBeNull();

        while (state) {
            const result = recordBinaryChoice(state, true, () => 0.5);
            if (result.complete) {
                expect(result.finalIndex).toBe(0);
                return;
            }
            state = result.state;
        }
    });

    it("places a new entry at the bottom", () => {
        let state = startBinaryState(4, () => 0.5);
        expect(state).not.toBeNull();

        while (state) {
            const result = recordBinaryChoice(state, false, () => 0.5);
            if (result.complete) {
                expect(result.finalIndex).toBe(4);
                return;
            }
            state = result.state;
        }
    });

    it("supports a single existing entry", () => {
        const state = startBinaryState(1, () => 0);
        expect(state?.pivotIndex).toBe(0);

        const result = recordBinaryChoice(state!, false, () => 0);
        expect(result.complete).toBe(true);
        expect(result.finalIndex).toBe(1);
    });

    it("keeps pivots inside the active range", () => {
        for (let index = 0; index < 20; index += 1) {
            const pivot = chooseBinaryPivot(3, 9, () => index / 20);
            expect(pivot).toBeGreaterThanOrEqual(3);
            expect(pivot).toBeLessThan(9);
        }
    });
});

describe("free-rank Elo", () => {
    it("raises the winner and lowers the loser from equal ratings", () => {
        const result = updateEloPair(1500, 1500);
        expect(result.winnerElo).toBe(1516);
        expect(result.loserElo).toBe(1484);
    });

    it("can update new entries faster with a higher early K-factor", () => {
        expect(eloKFactorForMatchCount(0)).toBeGreaterThan(eloKFactorForMatchCount(40));

        const result = updateEloPair(
            1500,
            1500,
            eloKFactorForMatchCount(0),
            eloKFactorForMatchCount(0)
        );
        expect(result.winnerElo).toBe(1532);
        expect(result.loserElo).toBe(1468);
    });
});

describe("rank prior Elo", () => {
    it("seeds top, middle, and bottom entries from binary rank", () => {
        expect(rankPriorElo(0, 101)).toBe(1900);
        expect(rankPriorElo(50, 101)).toBe(1500);
        expect(rankPriorElo(100, 101)).toBe(1100);
    });

    it("preserves free-rank residual when binary rank changes", () => {
        const currentElo = rankPriorElo(40, 101) + 75;
        const rebased = rebaseEloForRankChange(currentElo, 40, 101, 20, 101);
        expect(rebased).toBe(rankPriorElo(20, 101) + 75);
    });
});

describe("free-rank matchup selection", () => {
    it("picks a random eligible category when category is Any", () => {
        const categories = [
            category("Books", [entry("a", 0)]),
            category("Movies", [entry("b", 0), entry("c", 1)]),
            category("Games", [entry("d", 0), entry("e", 1)])
        ];

        const matchup = selectFreeRankMatchup(categories, "any", () => 0.75);
        expect(matchup?.categoryName).toBe("Games");
        expect(matchup?.entryA.id).not.toBe(matchup?.entryB.id);
    });

    it("returns null when the selected category has fewer than two entries", () => {
        const categories = [category("Books", [entry("a", 0)])];
        expect(selectFreeRankMatchup(categories, categories[0].id, () => 0)).toBeNull();
    });

    it("weights Any category selection by possible matchup count", () => {
        const categories = [
            category("Small", [entry("a", 0), entry("b", 1)]),
            category("Large", [entry("c", 0), entry("d", 1), entry("e", 2), entry("f", 3)])
        ];
        const random = sequenceRandom([0.2, 0, 0]);

        const matchup = selectFreeRankMatchup(categories, "any", random);
        expect(matchup?.categoryName).toBe("Large");
    });

    it("prefers entries with fewer free-rank matches inside the selected category", () => {
        const categories = [
            category("Books", [
                entry("new", 0, 1500, 0, 0),
                entry("veteran", 1, 1500, 99, 0),
                entry("middle", 2, 1500, 8, 0)
            ])
        ];
        const random = sequenceRandom([0, 0.4, 0]);

        const matchup = selectFreeRankMatchup(categories, "any", random);
        expect(matchup?.entryA.id).toBe("new");
        expect(matchup?.entryB.id).toBe("veteran");
    });
});

describe("combined order", () => {
    it("keeps binary order dominant with bounded Elo movement", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(
                String(index),
                index,
                index === 19 ? rankPriorElo(index, 20) + 600 : rankPriorElo(index, 20),
                10,
                0
            )
        );

        const ordered = combinedOrder(entries);
        const movedEntryIndex = ordered.findIndex((candidate) => candidate.id === "19");
        expect(movedEntryIndex).toBeGreaterThanOrEqual(17);
        expect(movedEntryIndex).toBeLessThan(19);
    });

    it("uses residual Elo against binary rank prior", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(String(index), index, rankPriorElo(index, 20), 20, 0)
        );

        const ordered = combinedOrder(entries);
        expect(ordered.map((candidate) => candidate.id)).toEqual(
            entries.map((candidate) => candidate.id)
        );
    });
});

describe("derived star ratings", () => {
    it("maps combined rank to the default skewed percentile star curve", () => {
        expect(starRatingForCombinedRank(0, 287)).toBe(5);
        expect(starRatingForCombinedRank(286, 287)).toBe(1);
        expect(starRatingForCombinedRank(29, 287)).toBeCloseTo(4.7, 1);
        expect(starRatingForCombinedRank(143, 287)).toBeCloseTo(3.7, 1);
    });

    it("supports a configurable star curve", () => {
        const curve = parseStarRatingCurveText("0 10\n50 7\n100 1");
        expect(starRatingScaleMax(curve)).toBe(10);
        expect(starRatingForCombinedRank(5, 11, curve)).toBe(7);
        expect(starRatingForCombinedRank(10, 11, curve)).toBe(1);
    });

    it("uses combined order rather than raw binary position", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(
                String(index),
                index,
                index === 19 ? rankPriorElo(index, 20) + 600 : rankPriorElo(index, 20),
                10,
                0
            )
        );

        const ratings = starRatingsByEntryId(entries);
        expect(ratings.get("19")).toBeGreaterThan(starRatingForCombinedRank(19, 20));
    });
});

function category(name: string, entries: Entry[]): CategoryWithEntries {
    return {
        id: name.toLowerCase(),
        name,
        sortOrder: 0,
        createdAt: 0,
        entries
    };
}

function entry(
    id: string,
    rankPosition: number,
    freeRankElo = 1500,
    freeRankWins = 0,
    freeRankLosses = 0
): Entry {
    return {
        id,
        categoryId: "category",
        name: id,
        rankPosition,
        imageKey: null,
        createdAt: 0,
        firstConsumedAt: null,
        freeRankElo,
        freeRankWins,
        freeRankLosses
    };
}

function sequenceRandom(values: number[]) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
}
