import { ChromeMessaging } from "/src/content/infrastructure/ChromeMessaging.ts.js";
import {
  extractChatId,
  normalizeText,
  sha1Hex,
  getTurn,
  HASH_HEAD,
  WIN_PRE,
  WIN_POST,
  MSG_SEL
} from "/src/content/utils.ts.js";
export class BookmarksService {
  messaging;
  constructor(messaging) {
    this.messaging = messaging || new ChromeMessaging();
  }
  // ===========================
  // DOMAIN LOGIC (from BookmarksDomain)
  // ===========================
  /**
   * Create a bookmark from current text selection
   * Contains complex DOM logic for text selection and fingerprinting
   */
  async createBookmarkFromSelection(note = "", tags = []) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const selectedText = sel.toString().trim();
    if (!selectedText) return null;
    const node = sel.anchorNode || sel.focusNode;
    const msgEl = node?.parentElement?.closest(MSG_SEL);
    if (!msgEl) return null;
    const msgText = msgEl.innerText || "";
    const norm = normalizeText(msgText);
    const fingerprint = await sha1Hex(norm.slice(0, HASH_HEAD));
    const normSel = normalizeText(selectedText);
    let startOffset = norm.indexOf(normSel);
    let endOffset = startOffset + normSel.length;
    if (startOffset < 0) {
      startOffset = 0;
      endOffset = Math.min(norm.length, 50);
    }
    const len = Math.max(1, endOffset - startOffset);
    const winStart = Math.max(0, startOffset - WIN_PRE);
    const winEnd = Math.min(norm.length, endOffset + WIN_POST);
    const anchor = norm.slice(winStart, winEnd);
    const anchorHash = await sha1Hex(anchor);
    const relStart = startOffset - winStart;
    const sample = norm.slice(
      Math.max(0, startOffset - 40),
      Math.min(norm.length, endOffset + 40)
    );
    const turn = getTurn(msgEl) ?? void 0;
    const bookmark = {
      chatId: extractChatId(),
      url: window.location.href,
      selectedText,
      note,
      tags,
      timestamp: /* @__PURE__ */ new Date(),
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
  validateBookmark(bookmark) {
    return !!(bookmark.chatId && bookmark.selectedText && bookmark.url && bookmark.selection && bookmark.msg);
  }
  /**
   * Check if a bookmark can be deleted (business rules)
   */
  canDeleteBookmark(bookmark) {
    return true;
  }
  /**
   * Handle post-deletion side effects
   */
  async onBookmarkDeleted(bookmark) {
    console.log("[BookmarksService] Post-deletion cleanup for:", bookmark.id);
  }
  // ===========================
  // APPLICATION SERVICE LOGIC
  // ===========================
  /**
   * Create and save a bookmark from current selection
   */
  async createAndSaveBookmark(note = "", tags = []) {
    try {
      const bookmark = await this.createBookmarkFromSelection(note, tags);
      if (!bookmark) {
        console.warn("[BookmarksService] No valid selection found");
        return null;
      }
      if (!this.validateBookmark(bookmark)) {
        console.error("[BookmarksService] Invalid bookmark data");
        return null;
      }
      const bookmarkId = await this.saveBookmark(bookmark);
      console.log("[BookmarksService] Bookmark created and saved with ID:", bookmarkId);
      return bookmarkId;
    } catch (error) {
      console.error("[BookmarksService] Error creating bookmark:", error);
      throw error;
    }
  }
  /**
   * Save bookmark to database via service worker
   */
  async saveBookmark(bookmark) {
    console.log("[BookmarksService] Saving bookmark:", bookmark);
    const dbBookmark = {
      url: bookmark.url,
      chatId: bookmark.chatId,
      selectedText: bookmark.selectedText,
      note: bookmark.note,
      tags: bookmark.tags,
      timestamp: bookmark.timestamp,
      isHighlighted: bookmark.isHighlighted
    };
    const bookmarkId = await this.messaging.send({
      type: "ADD_BOOKMARK_DB",
      data: dbBookmark
    });
    console.log("[BookmarksService] Bookmark saved with ID:", bookmarkId);
    return bookmarkId;
  }
  /**
   * Get bookmarks for current chat
   */
  async getBookmarksForCurrentChat() {
    const chatId = extractChatId();
    console.log("[BookmarksService] Getting bookmarks for chat:", chatId);
    try {
      const bookmarks = await this.messaging.send({
        type: "GET_BOOKMARKS_BY_CHAT",
        data: { chatId }
      });
      console.log("[BookmarksService] Retrieved", bookmarks.length, "bookmarks");
      return bookmarks;
    } catch (error) {
      console.error("[BookmarksService] Error getting bookmarks:", error);
      return [];
    }
  }
  /**
   * Delete a bookmark - orchestrates the entire deletion process
   */
  async deleteBookmark(bookmarkId) {
    console.log("[BookmarksService] Orchestrating bookmark deletion:", bookmarkId);
    try {
      const bookmark = await this.getBookmarkById(bookmarkId);
      if (!bookmark) {
        throw new Error("Bookmark not found");
      }
      if (!this.validateBookmark(bookmark)) {
        throw new Error("Invalid bookmark data");
      }
      await this.messaging.send({
        type: "DELETE_BOOKMARK_DB",
        data: { bookmarkId }
      });
      this.notifyUIOfDeletion(bookmarkId);
      await this.onBookmarkDeleted(bookmark);
      console.log("[BookmarksService] Bookmark deletion completed:", bookmarkId);
    } catch (error) {
      console.error("[BookmarksService] Bookmark deletion failed:", error);
      throw error;
    }
  }
  /**
   * Get a single bookmark by ID
   */
  async getBookmarkById(bookmarkId) {
    try {
      const bookmark = await this.messaging.send({
        type: "GET_BOOKMARK_BY_ID",
        data: { bookmarkId }
      });
      return bookmark;
    } catch (error) {
      console.error("[BookmarksService] Error getting bookmark by ID:", error);
      return null;
    }
  }
  /**
   * Notify UI components of bookmark deletion
   */
  notifyUIOfDeletion(bookmarkId) {
    window.dispatchEvent(new CustomEvent("gpt-notes:bookmark-deleted", {
      detail: { bookmarkId }
    }));
  }
}
export const bookmarksService = new BookmarksService();
