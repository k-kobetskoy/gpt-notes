// Content script utilities - consolidated from all content modules

// ===========================
// CONSTANTS
// ===========================

export const HASH_HEAD = 4096;         // How many characters of message to hash for fingerprint
export const WIN_PRE = 48;             // Prefix window size for anchor
export const WIN_POST = 48;            // Suffix window size for anchor
export const MSG_SEL = '[data-testid^="conversation-turn-"], [data-message-id], [role="article"]';
export const TURN_RE = /conversation-turn-(\d+)/;

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Extract chat ID from ChatGPT URL
 */
export function extractChatId(url: string = window.location.href): string {
  const match = url.match(/\/c\/([^\/\?#]+)/);
  return match ? match[1] : 'default';
}

/**
 * Normalize text by collapsing whitespace
 */
export function normalizeText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Generate SHA-1 hex hash of a string
 */
export async function sha1Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract turn number from conversation element
 */
export function getTurn(el: Element): number | null {
  const t = el.getAttribute?.('data-testid');
  if (!t) return null;
  const m = t.match(TURN_RE);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Get conversation turn element by turn number
 */
export function getTurnEl(turn: number): Element | null {
  return document.querySelector(`[data-testid="conversation-turn-${turn}"]`);
}