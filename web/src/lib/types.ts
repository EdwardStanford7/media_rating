export type RankingSource = "new_entry" | "rerank_entry" | "switch_category";
export type RankingOperationKind = "single";

export interface Entry {
    id: string;
    categoryId: string;
    name: string;
    rankPosition: number;
    imageKey: string | null;
    createdAt: number;
    firstConsumedAt: number | null;
}

export interface QueueSettings {
    enabled: boolean;
    delayDays: number;
    promptForMissingImages: boolean;
}

export interface QueuedEntry {
    id: string;
    categoryId: string;
    categoryName: string;
    name: string;
    imageKey: string | null;
    firstConsumedAt: number | null;
    availableAt: number;
    createdAt: number;
}

export interface CategoryWithEntries {
    id: string;
    name: string;
    sortOrder: number;
    createdAt: number;
    isPublic: boolean;
    entries: Entry[];
}

export interface CurrentUserProfile {
    userId: string;
    slug: string;
    isPublic: boolean;
}

export interface DashboardData {
    categories: CategoryWithEntries[];
    queueSettings: QueueSettings;
    queuedEntries: QueuedEntry[];
    activeBinarySession: ActiveBinarySession | null;
    profile: CurrentUserProfile;
}

export interface ProfileSettingsCategory {
    id: string;
    name: string;
    sortOrder: number;
    entryCount: number;
    isPublic: boolean;
}

export type FollowStatus = "pending" | "accepted";
export type FollowRelationState =
    | "none"
    | "requested"
    | "incoming_request"
    | "following"
    | "follows_you"
    | "mutual";

export interface FollowProfileSummary {
    userId: string;
    name: string;
    imageKey: string | null;
    slug: string;
    isPublic: boolean;
    publicCategoryCount: number;
    relationState: FollowRelationState;
    createdAt: number;
    acceptedAt: number | null;
}

export interface FollowSearchResult extends FollowProfileSummary {
    matchKind: "public_profile";
}

export interface ProfileSettingsData {
    user: {
        id: string;
        name: string;
        imageKey: string | null;
        slug: string;
        isPublic: boolean;
    };
    categories: ProfileSettingsCategory[];
    following: FollowProfileSummary[];
    followers: FollowProfileSummary[];
    incomingFollowRequests: FollowProfileSummary[];
    outgoingFollowRequests: FollowProfileSummary[];
}

export interface PublicProfileSummary {
    userId: string;
    name: string;
    imageKey: string | null;
    slug: string;
    isPublic: boolean;
    isSelf: boolean;
    relationState: FollowRelationState;
}

export interface ProfileCopyTargetCategory {
    id: string;
    name: string;
}

export interface PublicProfileData {
    profile: PublicProfileSummary;
    categories: CategoryWithEntries[];
    viewer: {
        isSignedIn: boolean;
        isSelf: boolean;
        relationState: FollowRelationState;
        categories: ProfileCopyTargetCategory[];
    };
}

export interface ActiveBinarySession {
    id: string;
    categoryId: string;
    categoryName: string;
    subjectName: string;
    source: RankingSource;
    operationKind: RankingOperationKind;
}

export interface BinarySessionView {
    id: string;
    categoryId: string;
    categoryName: string;
    source: RankingSource;
    operationKind: RankingOperationKind;
    phase: "binary" | "local_repair";
    subject: Entry;
    opponent: Entry;
    lowerBound: number;
    upperBound: number;
    comparisonCount: number;
}

export interface ParsedImportEntry {
    categoryName: string;
    name: string;
    rankPosition: number;
    firstConsumedAt: number | null;
}

export interface ParsedImport {
    entries: ParsedImportEntry[];
}

export type AdminUserSearchField = "all" | "email" | "name";

export interface AdminUserSummary {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    imageKey: string | null;
    role: string;
    banned: boolean;
    banReason: string | null;
    banExpires: number | null;
    createdAt: number;
    updatedAt: number;
    profileSlug: string | null;
    profileIsPublic: boolean | null;
    categoryCount: number;
    entryCount: number;
    queuedEntryCount: number;
    activeSessionCount: number;
}

export interface AdminUserListData {
    users: AdminUserSummary[];
    total: number;
    limit: number;
    offset: number;
    search: string;
    searchField: AdminUserSearchField;
}

export interface AdminSessionSummary {
    id: string;
    expiresAt: number;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: number;
    updatedAt: number;
    impersonatedBy: string | null;
}

export interface AdminUserDetailData {
    user: AdminUserSummary;
    sessions: AdminSessionSummary[];
}
