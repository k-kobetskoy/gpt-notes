// Content script types - consolidated from all content modules

// ===========================
// BOOKMARK TYPES
// ===========================

export interface Bookmark {
    id?: number;  // Always use database ID
    version?: number;
    chatId: string;
    url: string;
    selectedText: string;
    note?: string;
    turn?: number;
    tags: string[];
    timestamp: Date;
    isHighlighted: boolean;
    msg?: {
        fingerprint: string;
        sample: string;
    };
    selection?: {
        start: number;
        end: number;
        len: number;
        anchor: string;
        anchorHash: string;
        relStart: number;
    };
    createdAt?: number;
}

// ===========================
// CHAT MAP TYPES
// ===========================

export interface MapNode {
    turn: number;
    role: 'user' | 'assistant';
    fingerprint?: string;
    snippet?: string;
    hasBookmarks?: boolean;
    bookmarks?: Array<{
        id: string;
        start: number;
        end: number;
        note: string;
    }>;
    approxTop?: number;
    hydrated?: boolean;
}

export interface NormIndex {
    norm: string;
    map: Array<{ node: Node; rawOffset: number }>;
}

// ===========================
// MESSAGING TYPES
// ===========================

export interface MessageResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}
