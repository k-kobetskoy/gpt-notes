console.log("Gpt-Notes content script loaded");
import { extractChatId } from "/src/content/utils.ts.js";
import { bookmarksService } from "/src/content/services/BookmarksService.ts.js";
import { chromeMessaging } from "/src/content/infrastructure/ChromeMessaging.ts.js";
import { init, jumpToBookmark } from "/src/content/chatMapEngine.ts.js";
import { mountTimeline } from "/src/content/timeline/timeline.ts.js";
async function initializeChatMapEngine() {
  console.log("Gpt-Notes content script initializing...");
  try {
    init();
    console.log("ChatMapEngine initialized successfully");
    const unmountTimeline = await mountTimeline();
    console.log("Timeline mounted successfully");
  } catch (error) {
    console.error("Error initializing ChatMapEngine:", error);
  }
}
chromeMessaging.onMessage((message, sender, sendResponse) => {
  console.log("Content script received message:", message);
  (async () => {
    try {
      switch (message.type) {
        case "GET_BOOKMARKS":
          const bookmarks = await bookmarksService.getBookmarksForCurrentChat();
          sendResponse({ success: true, data: bookmarks });
          break;
        case "GET_CURRENT_CHAT_ID":
          sendResponse({ success: true, data: extractChatId() });
          break;
        case "JUMP_TO_BOOKMARK":
          const jumpSuccess = await jumpToBookmark(message.data.bookmarkId);
          sendResponse({ success: jumpSuccess });
          break;
        case "DELETE_BOOKMARK":
          await bookmarksService.deleteBookmark(message.data.bookmarkId);
          sendResponse({ success: true });
          break;
        case "CREATE_BOOKMARK":
          const bookmarkId = await bookmarksService.createAndSaveBookmark(
            message.data?.note || "",
            message.data?.tags || []
          );
          sendResponse({ success: !!bookmarkId, data: bookmarkId });
          break;
        default:
          console.warn("Unknown message type:", message.type);
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: String(error) });
    }
  })();
  return true;
});
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeChatMapEngine);
} else {
  initializeChatMapEngine();
}
