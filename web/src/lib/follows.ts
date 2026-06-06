import type { FollowRelationState, FollowStatus } from "./types";

export function deriveFollowRelationState(
    outgoingStatus: FollowStatus | null | undefined,
    incomingStatus: FollowStatus | null | undefined
): FollowRelationState {
    const outgoingAccepted = outgoingStatus === "accepted";
    const incomingAccepted = incomingStatus === "accepted";

    if (outgoingAccepted && incomingAccepted) {
        return "mutual";
    }

    if (outgoingAccepted) {
        return "following";
    }

    if (outgoingStatus === "pending") {
        return "requested";
    }

    if (incomingStatus === "pending") {
        return "incoming_request";
    }

    if (incomingAccepted) {
        return "follows_you";
    }

    return "none";
}

export function canViewProfile(
    profileIsPublic: boolean,
    isSelf: boolean,
    relationState: FollowRelationState
) {
    return profileIsPublic || isSelf || relationState === "following" || relationState === "mutual";
}

export function followButtonLabel(relationState: FollowRelationState) {
    switch (relationState) {
        case "incoming_request":
            return "Accept Request";
        case "requested":
            return "Requested";
        case "following":
            return "Following";
        case "mutual":
            return "Mutual";
        default:
            return "Follow";
    }
}

export function followRelationLabel(relationState: FollowRelationState) {
    switch (relationState) {
        case "incoming_request":
            return "Requested to follow you";
        case "requested":
            return "Request sent";
        case "following":
            return "Following";
        case "follows_you":
            return "Follows you";
        case "mutual":
            return "Mutual";
        default:
            return "Not following";
    }
}
