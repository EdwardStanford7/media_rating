import { describe, expect, it } from "vitest";
import {
    chooseBinaryPivot,
    advanceBubbleRepairState,
    combinedOrder,
    eloKFactorForMatchCount,
    generateNormalStarRatingCurve,
    parseStarRatingCurveText,
    rankPriorElo,
    recordBinaryChoice,
    recordLocalRepairChoice,
    rebaseEloForRankChange,
    selectFreeRankMatchup,
    startBinaryState,
    startBubbleRepairState,
    startLocalRepairState,
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

describe("local repair ranking", () => {
    it("checks the insertion neighbors before committing", () => {
        expect(startLocalRepairState(0, 5)).toEqual({
            phase: "repair_down",
            finalIndex: 0,
            opponentIndex: 0,
            initialUpwardCheck: false
        });
        expect(startLocalRepairState(3, 6)).toEqual({
            phase: "repair_up",
            finalIndex: 3,
            opponentIndex: 2,
            initialUpwardCheck: true
        });
        expect(startLocalRepairState(0, 0)).toBeNull();
    });

    it("continues upward when the subject beats the left neighbor", () => {
        const state = startLocalRepairState(4, 8);
        expect(state).not.toBeNull();

        const result = recordLocalRepairChoice(state!, true, 8);
        expect(result.complete).toBe(false);
        expect(result.finalIndex).toBe(3);
        expect(result.state).toEqual({
            phase: "repair_up",
            finalIndex: 3,
            opponentIndex: 2,
            initialUpwardCheck: false
        });
    });

    it("falls through to the right-side check when the left neighbor wins", () => {
        const state = startLocalRepairState(4, 8);
        expect(state).not.toBeNull();

        const result = recordLocalRepairChoice(state!, false, 8);
        expect(result.complete).toBe(false);
        expect(result.finalIndex).toBe(4);
        expect(result.state).toEqual({
            phase: "repair_down",
            finalIndex: 4,
            opponentIndex: 4,
            initialUpwardCheck: false
        });
    });

    it("continues downward when the right neighbor beats the subject", () => {
        const state = startLocalRepairState(0, 5);
        expect(state).not.toBeNull();

        const result = recordLocalRepairChoice(state!, false, 5);
        expect(result.complete).toBe(false);
        expect(result.finalIndex).toBe(1);
        expect(result.state).toEqual({
            phase: "repair_down",
            finalIndex: 1,
            opponentIndex: 1,
            initialUpwardCheck: false
        });
    });
});

describe("bubble repair ranking", () => {
    it("repairs an insertion that landed too high", () => {
        let state = startBubbleRepairState(["a", "b-", "d", "b", "c", "e"], "b-");
        const comparisons = [
            { winnerId: "b", loserId: "b-" },
            { winnerId: "b", loserId: "d" },
            { winnerId: "c", loserId: "d" },
            { winnerId: "d", loserId: "e" },
            { winnerId: "b-", loserId: "c" },
            { winnerId: "a", loserId: "b" }
        ];

        const result = advanceBubbleRepairState(state, comparisons);
        state = result.state;

        expect(result.complete).toBe(true);
        expect(state.workingOrderIds).toEqual(["a", "b", "b-", "c", "d", "e"]);
    });

    it("repairs an insertion that landed too low", () => {
        let state = startBubbleRepairState(["a", "d", "b", "b-", "c", "e"], "b-");
        const comparisons = [
            { winnerId: "b-", loserId: "d" },
            { winnerId: "b", loserId: "d" },
            { winnerId: "a", loserId: "b" },
            { winnerId: "b-", loserId: "d" },
            { winnerId: "b", loserId: "b-" },
            { winnerId: "c", loserId: "d" },
            { winnerId: "d", loserId: "e" },
            { winnerId: "b-", loserId: "c" }
        ];

        const result = advanceBubbleRepairState(state, comparisons);
        state = result.state;

        expect(result.complete).toBe(true);
        expect(state.workingOrderIds).toEqual(["a", "b", "b-", "c", "d", "e"]);
    });

    it("prompts for missing comparisons and resumes with the cached answer", () => {
        const state = startBubbleRepairState(["a", "d", "b", "b-", "c", "e"], "b-");
        const firstStep = advanceBubbleRepairState(state, []);

        expect(firstStep.complete).toBe(false);
        expect(firstStep.state.currentComparison).toEqual({
            entryAId: "b-",
            entryBId: "d"
        });

        const secondStep = advanceBubbleRepairState(firstStep.state, [
            { winnerId: "b-", loserId: "d" }
        ]);
        expect(secondStep.state.currentComparison).not.toEqual(firstStep.state.currentComparison);
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

    it("prefers closer-ranked opponents once the anchor has enough matches", () => {
        const categories = [
            category("Books", [
                entry("anchor", 0, 1900, 30, 0),
                entry("near", 1, 1840, 30, 0),
                entry("far", 2, 1100, 30, 0)
            ])
        ];
        const random = sequenceRandom([0, 0, 0.55]);

        const matchup = selectFreeRankMatchup(categories, "books", random);
        expect(matchup?.entryA.id).toBe("anchor");
        expect(matchup?.entryB.id).toBe("near");
    });

    it("penalizes recently repeated free-rank pairs", () => {
        const categories = [
            category("Books", [
                entry("anchor", 0, 1900, 30, 0),
                entry("repeated", 1, 1840, 30, 0),
                entry("fresh", 2, 1800, 30, 0)
            ])
        ];
        const random = sequenceRandom([0, 0, 0.1]);

        const matchup = selectFreeRankMatchup(categories, "books", random, {
            now: 10_000,
            pairHistory: [
                {
                    entryAId: "anchor",
                    entryBId: "repeated",
                    matchCount: 5,
                    lastMatchedAt: 10_000
                }
            ]
        });
        expect(matchup?.entryA.id).toBe("anchor");
        expect(matchup?.entryB.id).toBe("fresh");
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

    it("can generate a normal-distribution-style curve from simple settings", () => {
        const curve = generateNormalStarRatingCurve({
            minStars: 1,
            maxStars: 5,
            averageStars: 4,
            withinOneStarPercent: 70
        });

        expect(starRatingScaleMax(curve)).toBe(5);
        expect(starRatingForCombinedRank(0, 101, curve)).toBe(5);
        expect(starRatingForCombinedRank(50, 101, curve)).toBe(4);
        expect(starRatingForCombinedRank(100, 101, curve)).toBe(1);
    });

    it("uses ordered-list position rather than Elo state", () => {
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
        expect(ratings.get("19")).toBe(starRatingForCombinedRank(19, 20));
    });
});

function category(name: string, entries: Entry[]): CategoryWithEntries {
    return {
        id: name.toLowerCase(),
        name,
        sortOrder: 0,
        createdAt: 0,
        starRatingCurve: null,
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
