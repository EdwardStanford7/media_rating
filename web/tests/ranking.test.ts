import { describe, expect, it } from "vitest";
import {
    chooseBinaryPivot,
    advanceBubbleRepairState,
    advanceRandomAuditBubbleState,
    generateNormalStarRatingCurve,
    parseStarRatingCurveText,
    recordBinaryChoice,
    recordLocalRepairChoice,
    selectRandomAuditIndexes,
    startBinaryState,
    startBubbleRepairState,
    startRandomAuditBubbleState,
    startLocalRepairState,
    starRatingForRank,
    starRatingScaleMax,
    starRatingsByEntryId
} from "../src/lib/ranking";
import type { Entry } from "../src/lib/types";

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

describe("random audit ranking", () => {
    it("selects bounded pairs with a close-rank bias", () => {
        expect(selectRandomAuditIndexes(1)).toBeNull();
        expect(selectRandomAuditIndexes(5, () => 0)).toEqual({
            higherIndex: 0,
            lowerIndex: 1
        });

        const farPair = selectRandomAuditIndexes(5, () => 0.999);
        expect(farPair).toEqual({
            higherIndex: 0,
            lowerIndex: 4
        });
    });

    it("repairs a failed audit by bubbling the lower entry up and the higher entry down", () => {
        let state = startRandomAuditBubbleState(["a", "b", "c", "d", "e"], "b", "d");
        const comparisons = [
            { winnerId: "d", loserId: "b" },
            { winnerId: "d", loserId: "c" },
            { winnerId: "a", loserId: "d" },
            { winnerId: "c", loserId: "b" },
            { winnerId: "b", loserId: "e" }
        ];

        const result = advanceRandomAuditBubbleState(state, comparisons);
        state = result.state;

        expect(result.complete).toBe(true);
        expect(state.workingOrderIds).toEqual(["a", "d", "c", "b", "e"]);
    });

    it("prompts only for missing audit bubble comparisons", () => {
        const state = startRandomAuditBubbleState(["a", "b", "c", "d"], "b", "d");
        const firstStep = advanceRandomAuditBubbleState(state, [
            { winnerId: "d", loserId: "b" },
            { winnerId: "d", loserId: "c" }
        ]);

        expect(firstStep.complete).toBe(false);
        expect(firstStep.state.currentComparison).toEqual({
            entryAId: "d",
            entryBId: "a"
        });

        const secondStep = advanceRandomAuditBubbleState(firstStep.state, [
            { winnerId: "d", loserId: "b" },
            { winnerId: "d", loserId: "c" }
        ]);
        expect(secondStep.state.currentComparison).toEqual(firstStep.state.currentComparison);
    });
});

describe("derived star ratings", () => {
    it("maps ordered-list rank to the default skewed percentile star curve", () => {
        expect(starRatingForRank(0, 287)).toBe(5);
        expect(starRatingForRank(286, 287)).toBe(1);
        expect(starRatingForRank(29, 287)).toBeCloseTo(4.7, 1);
        expect(starRatingForRank(143, 287)).toBeCloseTo(3.7, 1);
    });

    it("supports a configurable star curve", () => {
        const curve = parseStarRatingCurveText("0 10\n50 7\n100 1");
        expect(starRatingScaleMax(curve)).toBe(10);
        expect(starRatingForRank(5, 11, curve)).toBe(7);
        expect(starRatingForRank(10, 11, curve)).toBe(1);
    });

    it("can generate a normal-distribution-style curve from simple settings", () => {
        const curve = generateNormalStarRatingCurve({
            minStars: 1,
            maxStars: 5,
            averageStars: 4,
            withinOneStarPercent: 70
        });

        expect(starRatingScaleMax(curve)).toBe(5);
        expect(starRatingForRank(0, 101, curve)).toBe(5);
        expect(starRatingForRank(50, 101, curve)).toBe(4);
        expect(starRatingForRank(100, 101, curve)).toBe(1);
    });

    it("uses ordered-list position", () => {
        const entries = Array.from({ length: 20 }, (_, index) =>
            entry(String(index), index)
        );

        const ratings = starRatingsByEntryId(entries);
        expect(ratings.get("19")).toBe(starRatingForRank(19, 20));
    });
});

function entry(id: string, rankPosition: number): Entry {
    return {
        id,
        categoryId: "category",
        name: id,
        rankPosition,
        imageKey: null,
        createdAt: 0,
        firstConsumedAt: null
    };
}
