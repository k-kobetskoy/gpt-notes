import Dexie, { Table } from 'dexie';
import type { Bookmark } from '../content/types';

export interface ChatSession {
  id?: number;
  chatId: string;
  title: string;
  url: string;
  lastVisited: Date;
  bookmarkCount: number;
}

// Database class
export class BookmarksDatabase extends Dexie {
  bookmarks!: Table<Bookmark>;
  chatSessions!: Table<ChatSession>;

  constructor() {
    super('BookmarksDatabase');
    
    this.version(1).stores({
      bookmarks: '++id, chatId, url, timestamp, tags',
      chatSessions: '++id, chatId, lastVisited, bookmarkCount'
    });
  }

  async addBookmark(bookmark: Omit<Bookmark, 'id'>): Promise<number> {
    try {
      console.log('[DB] addBookmark start', bookmark);
      const bookmarkId = await this.bookmarks.add(bookmark as Bookmark);
      console.log('[DB] addBookmark saved id', bookmarkId);
      
      // Update or create chat session
      await this.updateChatSession(bookmark.chatId, bookmark.url);
      
      return bookmarkId as number;
    } catch (error) {
      console.error('[DB] Error adding bookmark:', error);
      throw error;
    }
  }

  async deleteBookmark(bookmarkId: number): Promise<void> {
    try {
      console.log('[DB] deleteBookmark start', bookmarkId);
      const bookmark = await this.bookmarks.get(bookmarkId);
      if (bookmark) {
        await this.bookmarks.delete(bookmarkId);
        // Update chat session bookmark count
        await this.updateChatSession(bookmark.chatId, bookmark.url);
      }
    } catch (error) {
      console.error('[DB] Error deleting bookmark:', error);
      throw error;
    }
  }

  async getBookmarksByChat(chatId: string): Promise<Bookmark[]> {
    try {
      console.log('[DB] getBookmarksByChat for', chatId);
      const res = await this.bookmarks.where('chatId').equals(chatId).toArray();
      console.log('[DB] getBookmarksByChat count', res.length);
      return res;
    } catch (error) {
      console.error('[DB] Error getting bookmarks by chat:', error);
      return [];
    }
  }

  async getAllBookmarks(): Promise<Bookmark[]> {
    try {
      return await this.bookmarks.toArray();
    } catch (error) {
      console.error('Error getting all bookmarks:', error);
      return [];
    }
  }

  async getBookmarkById(bookmarkId: number): Promise<Bookmark | undefined> {
    try {
      return await this.bookmarks.get(bookmarkId);
    } catch (error) {
      console.error('Error getting bookmark by id:', error);
      return undefined;
    }
  }

  async searchBookmarks(query: string): Promise<Bookmark[]> {
    try {
      const lowerQuery = query.toLowerCase();
      return await this.bookmarks.filter(bookmark => 
        bookmark.selectedText.toLowerCase().includes(lowerQuery) ||
        (bookmark.note && bookmark.note.toLowerCase().includes(lowerQuery)) ||
        bookmark.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      ).toArray();
    } catch (error) {
      console.error('Error searching bookmarks:', error);
      return [];
    }
  }

  async getBookmarksByTags(tags: string[]): Promise<Bookmark[]> {
    try {
      return await this.bookmarks.filter(bookmark =>
        tags.every(tag => bookmark.tags.includes(tag))
      ).toArray();
    } catch (error) {
      console.error('Error getting bookmarks by tags:', error);
      return [];
    }
  }

  async getAllTags(): Promise<string[]> {
    try {
      const bookmarks = await this.bookmarks.toArray();
      const tagSet = new Set<string>();
      bookmarks.forEach(bookmark => {
        bookmark.tags.forEach(tag => tagSet.add(tag));
      });
      return Array.from(tagSet).sort();
    } catch (error) {
      console.error('Error getting all tags:', error);
      return [];
    }
  }

  private async updateChatSession(chatId: string, url: string): Promise<void> {
    try {
      console.log('[DB] updateChatSession for', chatId);
      const bookmarkCount = await this.bookmarks.where('chatId').equals(chatId).count();
      const existingSession = await this.chatSessions.where('chatId').equals(chatId).first();
      
      const sessionData: Omit<ChatSession, 'id'> = {
        chatId,
        title: `Chat ${chatId.substring(0, 8)}...`,
        url,
        lastVisited: new Date(),
        bookmarkCount
      };

      if (existingSession) {
        await this.chatSessions.update(existingSession.id!, sessionData);
      } else {
        await this.chatSessions.add(sessionData as ChatSession);
      }
    } catch (error) {
      console.error('[DB] Error updating chat session:', error);
    }
  }

  async getChatSessions(): Promise<ChatSession[]> {
    try {
      return await this.chatSessions.orderBy('lastVisited').reverse().toArray();
    } catch (error) {
      console.error('Error getting chat sessions:', error);
      return [];
    }
  }

  async getAllChatSessions(): Promise<ChatSession[]> {
    return this.getChatSessions();
  }
}

// Create database instance
export const db = new BookmarksDatabase();