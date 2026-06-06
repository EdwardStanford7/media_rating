import { describe, expect, it } from "vitest";
import {
    canViewProfile,
    deriveFollowRelationState,
    followButtonLabel,
    followRelationLabel
} from "../src/lib/follows";

describe("follow relation state", () => {
    it("keeps one-sided, pending, and mutual states distinct", () => {
        expect(deriveFollowRelationState(null, null)).toBe("none");
        expect(deriveFollowRelationState("pending", null)).toBe("requested");
        expect(deriveFollowRelationState(null, "pending")).toBe("incoming_request");
        expect(deriveFollowRelationState("accepted", null)).toBe("following");
        expect(deriveFollowRelationState(null, "accepted")).toBe("follows_you");
        expect(deriveFollowRelationState("accepted", "accepted")).toBe("mutual");
    });

    it("unlocks private profile viewing only for self or accepted outgoing follows", () => {
        expect(canViewProfile(true, false, "none")).toBe(true);
        expect(canViewProfile(false, true, "none")).toBe(true);
        expect(canViewProfile(false, false, "following")).toBe(true);
        expect(canViewProfile(false, false, "mutual")).toBe(true);
        expect(canViewProfile(false, false, "requested")).toBe(false);
        expect(canViewProfile(false, false, "incoming_request")).toBe(false);
        expect(canViewProfile(false, false, "follows_you")).toBe(false);
    });

    it("uses stable labels for profile buttons and relationship text", () => {
        expect(followButtonLabel("none")).toBe("Follow");
        expect(followButtonLabel("incoming_request")).toBe("Accept Request");
        expect(followButtonLabel("requested")).toBe("Requested");
        expect(followButtonLabel("following")).toBe("Following");
        expect(followButtonLabel("mutual")).toBe("Mutual");
        expect(followRelationLabel("follows_you")).toBe("Follows you");
    });
});
