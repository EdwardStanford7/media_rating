import { describe, expect, it } from "vitest";
import {
    chooseBinaryPivot,
    combinedOrder,
    recordBinaryChoice,
    selectFreeRankMatchup,
    startBinaryState,
    starRatingForCombinedRank,
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
});

describe("combined order", () => {
    it("keeps binary order dominant with bounded Elo movement", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(String(index), index, index === 19 ? 2100 : 1500, 10, 0)
        );

        const ordered = combinedOrder(entries);
        const movedEntryIndex = ordered.findIndex((candidate) => candidate.id === "19");
        expect(movedEntryIndex).toBeGreaterThanOrEqual(17);
        expect(movedEntryIndex).toBeLessThan(19);
    });
});

describe("derived star ratings", () => {
    it("maps combined rank to a one-decimal normal-distribution star score", () => {
        expect(starRatingForCombinedRank(0, 287)).toBe(5);
        expect(starRatingForCombinedRank(286, 287)).toBe(1);
        expect(starRatingForCombinedRank(1, 287)).toBeGreaterThanOrEqual(4.8);
        expect(starRatingForCombinedRank(143, 287)).toBeCloseTo(3, 1);
    });

    it("uses combined order rather than raw binary position", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(String(index), index, index === 19 ? 2100 : 1500, 10, 0)
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
