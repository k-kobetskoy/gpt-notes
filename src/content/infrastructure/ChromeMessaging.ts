// Infrastructure layer - Chrome API wrapper
import type { MessageResponse } from '../types';

export { MessageResponse };

export class ChromeMessaging {
  /**
   * Send a message to the service worker and await response
   */
  async send<T = any>(message: any): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, undefined, (response: MessageResponse<T>) => {
        const lastError = (chrome.runtime as any).lastError;
        
        if (lastError) {
          console.error('[ChromeMessaging] Runtime error:', lastError);
          reject(new Error(lastError.message || 'Runtime message error'));
          return;
        }
        
        if (response?.success) {
          resolve(response.data as T);
        } else {
          console.error('[ChromeMessaging] Message failed:', response);
          reject(new Error(response?.error || 'Message failed'));
        }
      });
    });
  }

  /**
   * Send message without expecting a response
   */
  sendNoResponse(message: any): void {
    chrome.runtime.sendMessage(message);
  }

  /**
   * Listen for messages from other contexts
   */
  onMessage(callback: (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean | undefined): void {
    chrome.runtime.onMessage.addListener(callback);
  }
}

// Singleton instance
export const chromeMessaging = new ChromeMessaging();
