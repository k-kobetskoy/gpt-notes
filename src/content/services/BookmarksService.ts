// Application service layer - combines domain logic and infrastructure coordination
import { ChromeMessaging } from '../infrastructure/ChromeMessaging';
import type { Bookmark } from '../types';
import { 
  extractChatId, 
  normalizeText, 
  sha1Hex, 
  getTurn,
  HASH_HEAD,
  WIN_PRE,
  WIN_POST,
  MSG_SEL
} from '../utils';

export class BookmarksService {
  private messaging: ChromeMessaging;

  constructor(messaging?: ChromeMessaging) {
    this.messaging = messaging || new ChromeMessaging();
  }

  // ===========================
  // DOMAIN LOGIC (from BookmarksDomain)
  // ===========================

  /**
   * Create a bookmark from current text selection
   * Contains complex DOM logic for text selection and fingerprinting
   */
  async createBookmarkFromSelection(note = '', tags: string[] = []): Promise<Bookmark | null> {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const selectedText = sel.toString().trim();
    if (!selectedText) return null;

    // Find the message element containing the selection
    const node = sel.anchorNode || sel.focusNode;
    const msgEl = node?.parentElement?.closest(MSG_SEL);
    if (!msgEl) return null;

    // Get normalized text and create fingerprint
    const msgText = (msgEl as HTMLElement).innerText || '';
    const norm = normalizeText(msgText);
    const fingerprint = await sha1Hex(norm.slice(0, HASH_HEAD));

    // Find selection position in normalized text
    const normSel = normalizeText(selectedText);
    let startOffset = norm.indexOf(normSel);
    let endOffset = startOffset + normSel.length;
    
    // Fallback if not found
    if (startOffset < 0) {
      startOffset = 0;
      endOffset = Math.min(norm.length, 50);
    }

    const len = Math.max(1, endOffset - startOffset);

    // Create anchor window
    const winStart = Math.max(0, startOffset - WIN_PRE);
    const winEnd = Math.min(norm.length, endOffset + WIN_POST);
    const anchor = norm.slice(winStart, winEnd);
    const anchorHash = await sha1Hex(anchor);
    const relStart = startOffset - winStart;

    // Get sample text for fallback
    const sample = norm.slice(
      Math.max(0, startOffset - 40), 
      Math.min(norm.length, endOffset + 40)
    );

    // Get turn number if available
    const turn = getTurn(msgEl) ?? undefined;

    const bookmark: Bookmark = {
      chatId: extractChatId(),
      url: window.location.href,
      selectedText,
      note,
      tags,
      timestamp: new Date(),
      isHighlighted: false,
      selection: {
        start: startOffset,
        end: endOffset,
        len,
        anchor,
        anchorHash,
        relStart
      },
      msg: {
        fingerprint,
        sample
      },
      turn
    };

    return bookmark;
  }

  /**
   * Validate bookmark data
   */
  validateBookmark(bookmark: Bookmark): boolean {
    return !!(
      bookmark.chatId &&
      bookmark.selectedText &&
      bookmark.url &&
      bookmark.selection &&
      bookmark.msg
    );
  }

  /**
   * Check if a bookmark can be deleted (business rules)
   */
  canDeleteBookmark(bookmark: Bookmark): boolean {
    // Add any business rules here
    // For now, all bookmarks can be deleted
    return true;
  }

  /**
   * Handle post-deletion side effects
   */
  async onBookmarkDeleted(bookmark: Bookmark): Promise<void> {
    // Add any cleanup logic here
    // Examples: analytics, cache invalidation, etc.
    console.log('[BookmarksService] Post-deletion cleanup for:', bookmark.id);
  }

  // ===========================
  // APPLICATION SERVICE LOGIC
  // ===========================

  /**
   * Create and save a bookmark from current selection
   */
  async createAndSaveBookmark(note = '', tags: string[] = []): Promise<number | null> {
    try {
      // Create bookmark using domain logic
      const bookmark = await this.createBookmarkFromSelection(note, tags);
      if (!bookmark) {
        console.warn('[BookmarksService] No valid selection found');
        return null;
      }

      // Validate bookmark
      if (!this.validateBookmark(bookmark)) {
        console.error('[BookmarksService] Invalid bookmark data');
        return null;
      }

      // Save via infrastructure layer
      const bookmarkId = await this.saveBookmark(bookmark);

      console.log('[BookmarksService] Bookmark created and saved with ID:', bookmarkId);
      return bookmarkId;
    } catch (error) {
      console.error('[BookmarksService] Error creating bookmark:', error);
      throw error;
    }
  }

  /**
   * Save bookmark to database via service worker
   */
  async saveBookmark(bookmark: Bookmark): Promise<number> {
    console.log('[BookmarksService] Saving bookmark:', bookmark);
    
    // Convert to database format (remove id field)
    const dbBookmark: Omit<Bookmark, 'id'> = {
      url: bookmark.url,
      chatId: bookmark.chatId,
      selectedText: bookmark.selectedText,
      note: bookmark.note,
      tags: bookmark.tags,
      timestamp: bookmark.timestamp,
      isHighlighted: bookmark.isHighlighted
    };

    const bookmarkId = await this.messaging.send<number>({
      type: 'ADD_BOOKMARK_DB',
      data: dbBookmark
    });

    console.log('[BookmarksService] Bookmark saved with ID:', bookmarkId);
    return bookmarkId;
  }

  /**
   * Get bookmarks for current chat
   */
  async getBookmarksForCurrentChat(): Promise<Bookmark[]> {
    const chatId = extractChatId();
    console.log('[BookmarksService] Getting bookmarks for chat:', chatId);
    
    try {
      const bookmarks = await this.messaging.send<Bookmark[]>({
        type: 'GET_BOOKMARKS_BY_CHAT',
        data: { chatId }
      });
      
      console.log('[BookmarksService] Retrieved', bookmarks.length, 'bookmarks');
      return bookmarks;
    } catch (error) {
      console.error('[BookmarksService] Error getting bookmarks:', error);
      return [];
    }
  }

  /**
   * Delete a bookmark - orchestrates the entire deletion process
   */
  async deleteBookmark(bookmarkId: number): Promise<void> {
    console.log('[BookmarksService] Orchestrating bookmark deletion:', bookmarkId);
    
    try {
      // 1. Pre-deletion validation
      const bookmark = await this.getBookmarkById(bookmarkId);
      if (!bookmark) {
        throw new Error('Bookmark not found');
      }
      
      // 2. Domain business rules validation
      if (!this.validateBookmark(bookmark)) {
        throw new Error('Invalid bookmark data');
      }
      
      // 3. Execute database deletion
      await this.messaging.send({
        type: 'DELETE_BOOKMARK_DB',
        data: { bookmarkId }
      });
      
      // 4. Notify UI components of deletion
      this.notifyUIOfDeletion(bookmarkId);
      
      // 5. Post-deletion domain side effects
      await this.onBookmarkDeleted(bookmark);
      
      console.log('[BookmarksService] Bookmark deletion completed:', bookmarkId);
    } catch (error) {
      console.error('[BookmarksService] Bookmark deletion failed:', error);
      throw error;
    }
  }

  /**
   * Get a single bookmark by ID
   */
  async getBookmarkById(bookmarkId: number): Promise<Bookmark | null> {
    try {
      const bookmark = await this.messaging.send<Bookmark | null>({
        type: 'GET_BOOKMARK_BY_ID',
        data: { bookmarkId }
      });
      return bookmark;
    } catch (error) {
      console.error('[BookmarksService] Error getting bookmark by ID:', error);
      return null;
    }
  }

  /**
   * Notify UI components of bookmark deletion
   */
  private notifyUIOfDeletion(bookmarkId: number): void {
    // Dispatch custom event for ChatMapEngine and other UI components
    window.dispatchEvent(new CustomEvent('gpt-notes:bookmark-deleted', {
      detail: { bookmarkId }
    }));
  }
}

// Export singleton instance
export const bookmarksService = new BookmarksService();