// Service worker for Gpt-Notes extension

console.log('[SW] Gpt-Notes service worker loaded');
import { db } from './db/database';
import type { Bookmark } from './content/types';

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SW] Extension installed:', details.reason);
  
  // No chrome.storage initialization; Dexie is our source of truth
  if (details.reason === 'install') {
    // Optionally any Dexie warm-up can happen here
  }
});

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  console.log('[SW] Received message:', message);
  
  switch (message.type) {
    case 'ADD_BOOKMARK_DB':
      (async () => {
        try {
          const bookmark: Omit<Bookmark, 'id'> = message.data;
          console.time('[SW] ADD_BOOKMARK_DB');
          const id = await db.addBookmark(bookmark);
          console.timeEnd('[SW] ADD_BOOKMARK_DB');
          console.log('[SW] ADD_BOOKMARK_DB saved id:', id);
          
          // Get updated bookmarks list for the chat
          const updatedBookmarks = await db.getBookmarksByChat(bookmark.chatId);
          console.log('[SW] Sending BOOKMARKS_REFRESH with', updatedBookmarks.length, 'bookmarks');
          
          // Send BOOKMARKS_REFRESH with the complete updated list
          chrome.runtime.sendMessage({ 
            type: 'BOOKMARKS_REFRESH', 
            data: { 
              chatId: bookmark.chatId, 
              bookmarks: updatedBookmarks 
            } 
          });
          
          sendResponse({ success: true, data: id });
        } catch (e) {
          console.error('[SW] ADD_BOOKMARK_DB error', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true;

    case 'GET_BOOKMARKS_BY_CHAT':
      (async () => {
        try {
          console.time('[SW] GET_BOOKMARKS_BY_CHAT');
          const bookmarks = await db.getBookmarksByChat(message.data.chatId);
          console.timeEnd('[SW] GET_BOOKMARKS_BY_CHAT');
          console.log('[SW] GET_BOOKMARKS_BY_CHAT size:', bookmarks.length);
          sendResponse({ success: true, data: bookmarks });
        } catch (e) {
          console.error('[SW] GET_BOOKMARKS_BY_CHAT error', e);
          sendResponse({ success: false, error: String(e), data: [] });
        }
      })();
      return true;

    case 'GET_BOOKMARK_BY_ID':
      (async () => {
        try {
          const bookmark = await db.getBookmarkById(message.data.bookmarkId);
          sendResponse({ success: true, data: bookmark });
        } catch (e) {
          console.error('[SW] GET_BOOKMARK_BY_ID error', e);
          sendResponse({ success: false, error: String(e), data: undefined });
        }
      })();
      return true;

    case 'GET_BOOKMARK_BY_ID':
      (async () => {
        try {
          console.time('[SW] GET_BOOKMARK_BY_ID');
          const bookmark = await db.getBookmarkById(message.data.bookmarkId);
          console.timeEnd('[SW] GET_BOOKMARK_BY_ID');
          sendResponse({ success: true, data: bookmark });
        } catch (e) {
          console.error('[SW] GET_BOOKMARK_BY_ID error', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true;

    case 'DELETE_BOOKMARK_DB':
      (async () => {
        try {
          console.time('[SW] DELETE_BOOKMARK_DB');
          await db.deleteBookmark(message.data.bookmarkId);
          console.timeEnd('[SW] DELETE_BOOKMARK_DB');
          chrome.runtime.sendMessage({ type: 'BOOKMARK_DELETED', data: { bookmarkId: message.data.bookmarkId } });
          sendResponse({ success: true });
        } catch (e) {
          console.error('[SW] DELETE_BOOKMARK_DB error', e);
          sendResponse({ success: false, error: String(e) });
        }
      })();
      return true;
    // Remove legacy chrome.storage handlers
      
    case 'BOOKMARK_ADDED':
      // Handle new bookmark added from content script
      console.log('Bookmark added:', message.data);
      // No need to do anything here since ADD_BOOKMARK_DB already sends BOOKMARKS_REFRESH
      sendResponse({ success: true });
      return true;
      
    case 'BOOKMARK_DELETED':
      // Handle bookmark deleted from content script
      console.log('Bookmark deleted:', message.data);
      // Forward message to sidepanel
      chrome.runtime.sendMessage(message);
      sendResponse({ success: true });
      return true;
      
    // Removed legacy chrome.storage GET/DELETE APIs
      
    default:
      console.log('Unknown message type:', message.type);
      sendResponse({ error: 'Unknown message type' });
  }
});

// Handle side panel opening
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
