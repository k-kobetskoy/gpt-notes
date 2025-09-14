export {};
export class ChromeMessaging {
  /**
   * Send a message to the service worker and await response
   */
  async send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, void 0, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.error("[ChromeMessaging] Runtime error:", lastError);
          reject(new Error(lastError.message || "Runtime message error"));
          return;
        }
        if (response?.success) {
          resolve(response.data);
        } else {
          console.error("[ChromeMessaging] Message failed:", response);
          reject(new Error(response?.error || "Message failed"));
        }
      });
    });
  }
  /**
   * Send message without expecting a response
   */
  sendNoResponse(message) {
    chrome.runtime.sendMessage(message);
  }
  /**
   * Listen for messages from other contexts
   */
  onMessage(callback) {
    chrome.runtime.onMessage.addListener(callback);
  }
}
export const chromeMessaging = new ChromeMessaging();
