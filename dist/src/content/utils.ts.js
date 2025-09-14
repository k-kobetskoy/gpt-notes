export const HASH_HEAD = 4096;
export const WIN_PRE = 48;
export const WIN_POST = 48;
export const MSG_SEL = '[data-testid^="conversation-turn-"], [data-message-id], [role="article"]';
export const TURN_RE = /conversation-turn-(\d+)/;
export function extractChatId(url = window.location.href) {
  const match = url.match(/\/c\/([^\/\?#]+)/);
  return match ? match[1] : "default";
}
export function normalizeText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}
export async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function getTurn(el) {
  const t = el.getAttribute?.("data-testid");
  if (!t) return null;
  const m = t.match(TURN_RE);
  return m ? parseInt(m[1], 10) : null;
}
export function getTurnEl(turn) {
  return document.querySelector(`[data-testid="conversation-turn-${turn}"]`);
}
