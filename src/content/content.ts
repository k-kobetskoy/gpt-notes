// Content script for Gpt-Notes extension (clean architecture)
// This script runs on ChatGPT pages
console.log('Gpt-Notes content script loaded');

import { extractChatId } from './utils';
import { bookmarksService } from './services/BookmarksService';
import { chromeMessaging } from './infrastructure/ChromeMessaging';
import { init, jumpToBookmark } from './chatMapEngine';
import { mountTimeline } from './timeline/timeline';

async function initializeChatMapEngine(): Promise<void> {
  console.log('Gpt-Notes content script initializing...');
  try {
    // Initialize ChatMapEngine
    init();
    console.log('ChatMapEngine initialized successfully');
    // Mount Timeline
    const unmountTimeline = await mountTimeline();
    console.log('Timeline mounted successfully');
  } catch (error) {
    console.error('Error initializing ChatMapEngine:', error);
  }
}

// Message handler using clean architecture
chromeMessaging.onMessage((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  console.log('Content script received message:', message);
  
  (async () => {
    try {
      switch (message.type) {
        case 'GET_BOOKMARKS':
          const bookmarks = await bookmarksService.getBookmarksForCurrentChat();
          sendResponse({ success: true, data: bookmarks });
          break;
          
        case 'GET_CURRENT_CHAT_ID':
          sendResponse({ success: true, data: extractChatId() });
          break;
          
        case 'JUMP_TO_BOOKMARK':
          const jumpSuccess = await jumpToBookmark(message.data.bookmarkId);
          sendResponse({ success: jumpSuccess });
          break;
          
        case 'DELETE_BOOKMARK':
          // BookmarksService orchestrates the entire deletion process
          await bookmarksService.deleteBookmark(message.data.bookmarkId);
          sendResponse({ success: true });
          break;
          
        case 'CREATE_BOOKMARK':
          const bookmarkId = await bookmarksService.createAndSaveBookmark(
            message.data?.note || '',
            message.data?.tags || []
          );
          sendResponse({ success: !!bookmarkId, data: bookmarkId });
          break;
          
        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: String(error) });
    }
  })();
  
  return true; // Keep message channel open for async response
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChatMapEngine);
} else {
  initializeChatMapEngine();
}

 
