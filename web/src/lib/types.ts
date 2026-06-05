export type RankingSource = "new_entry" | "rerank_entry" | "switch_category";
export type RankingOperationKind = "single" | "random_audit";

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

export interface FriendProfileSummary {
    userId: string;
    name: string;
    imageKey: string | null;
    slug: string;
    isPublic: boolean;
    publicCategoryCount: number;
    friendedAt: number;
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
    friends: FriendProfileSummary[];
}

export interface PublicProfileSummary {
    userId: string;
    name: string;
    imageKey: string | null;
    slug: string;
    isPublic: boolean;
    isSelf: boolean;
    isFriend: boolean;
}

export interface PublicProfileData {
    profile: PublicProfileSummary;
    categories: CategoryWithEntries[];
    viewer: {
        isSignedIn: boolean;
        isSelf: boolean;
        isFriend: boolean;
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
