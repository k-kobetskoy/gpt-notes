export interface BookmarkRecord {
  id?: number;
  selectedText: string;
  note?: string;  // Renamed from noteText to match ChatMapEngine
  tags: string[];
  timestamp: Date;
  isHighlighted: boolean;
}

