export type DisplayMode = "ordered list" | "free_rank" | "combined";
export type MatchType = "binary_search" | "free_rank";
export type RankingSource = "new_entry" | "rerank_entry" | "switch_category";

export interface Entry {
    id: string;
    categoryId: string;
    name: string;
    rankPosition: number;
    imageKey: string | null;
    createdAt: number;
    firstConsumedAt: number | null;
    freeRankElo: number;
    freeRankWins: number;
    freeRankLosses: number;
}

export interface QueueSettings {
    enabled: boolean;
    delayDays: number;
    promptForMissingImages: boolean;
    showStarRatings: boolean;
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
    entries: Entry[];
}

export interface DashboardData {
    categories: CategoryWithEntries[];
    queueSettings: QueueSettings;
    queuedEntries: QueuedEntry[];
    activeBinarySession: ActiveBinarySession | null;
}

export interface ActiveBinarySession {
    id: string;
    categoryId: string;
    categoryName: string;
    subjectName: string;
    source: RankingSource;
}

export interface BinarySessionView {
    id: string;
    categoryId: string;
    categoryName: string;
    source: RankingSource;
    subject: Entry;
    opponent: Entry;
    lowerBound: number;
    upperBound: number;
    comparisonCount: number;
}

export interface FreeRankMatchup {
    categoryId: string;
    categoryName: string;
    entryA: Entry;
    entryB: Entry;
}

export interface MatchRecord {
    id: string;
    categoryId: string;
    entryAId: string;
    entryBId: string;
    winnerId: string;
    matchType: MatchType;
    rankingSessionId: string | null;
    entryAEloBefore: number | null;
    entryBEloBefore: number | null;
    entryAEloAfter: number | null;
    entryBEloAfter: number | null;
    createdAt: number;
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
