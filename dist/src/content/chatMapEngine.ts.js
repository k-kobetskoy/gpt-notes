"use strict";
import { bookmarksService } from "/src/content/services/BookmarksService.ts.js";
import {
  extractChatId,
  normalizeText,
  sha1Hex,
  getTurn,
  getTurnEl,
  HASH_HEAD,
  WIN_PRE,
  WIN_POST,
  MSG_SEL
} from "/src/content/utils.ts.js";
const SCAN_PAUSE_MS = 60;
const COARSE_STEPS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function getScrollContainer() {
  let best = document.scrollingElement || document.documentElement;
  document.querySelectorAll("*").forEach((n) => {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) {
      if (n.scrollHeight > best.scrollHeight) best = n;
    }
  });
  return best;
}
function iterVisibleMessages() {
  return Array.from(document.querySelectorAll(MSG_SEL));
}
function flash(el) {
  el.style.transition = "box-shadow .65s ease";
  el.style.boxShadow = "0 0 0 3px rgba(180,200,255,.9)";
  setTimeout(() => el.style.boxShadow = "", 700);
}
const NormCache = /* @__PURE__ */ new WeakMap();
function isVisible(el) {
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}
function buildNormIndex(rootEl) {
  const cached = NormCache.get(rootEl);
  if (cached) return cached;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  let norm = "";
  const map = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement || node.parentNode;
    if (!(parent instanceof Element) || !isVisible(parent)) continue;
    const inPre = !!parent.closest("pre, code");
    const raw = node.textContent || "";
    if (inPre) {
      for (let i = 0; i < raw.length; i++) {
        norm += raw[i];
        map.push({ node, rawOffset: i });
      }
    } else {
      for (let i = 0; i < raw.length; ) {
        if (/\s/.test(raw[i])) {
          let j = i;
          while (j < raw.length && /\s/.test(raw[j])) j++;
          if (norm && norm[norm.length - 1] !== " ") {
            norm += " ";
            map.push({ node, rawOffset: i });
          }
          i = j;
        } else {
          norm += raw[i];
          map.push({ node, rawOffset: i });
          i++;
        }
      }
    }
  }
  const res = { norm, map };
  NormCache.set(rootEl, res);
  return res;
}
function rangeFromNormOffsets(rootEl, start, end) {
  const { map } = buildNormIndex(rootEl);
  const s = clamp(start, 0, Math.max(0, map.length - 1));
  const e = clamp(Math.max(end, s + 1), 1, map.length);
  const r = document.createRange();
  r.setStart(map[s].node, map[s].rawOffset);
  r.setEnd(map[e - 1].node, map[e - 1].rawOffset);
  return r;
}
const PosCache = /* @__PURE__ */ new Map();
function installPositionObserver() {
  const sc = getScrollContainer();
  const io = new IntersectionObserver((entries) => {
    const scRect = sc.getBoundingClientRect();
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      const turn = getTurn(el);
      if (!Number.isInteger(turn) || turn === null) continue;
      const rect = el.getBoundingClientRect();
      const top = sc.scrollTop + (rect.top - scRect.top);
      PosCache.set(turn, top);
      const node = MapIndex.get(turn);
      if (node) {
        node.approxTop = top;
        MapIndex.set(turn, node);
      }
    }
  }, { root: sc, threshold: 0 });
  const hook = (root = document) => root.querySelectorAll(MSG_SEL).forEach((el) => io.observe(el));
  hook(document);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof Element)) continue;
        (n.matches?.(MSG_SEL) ? [n] : Array.from(n.querySelectorAll?.(MSG_SEL) || [])).forEach((el) => io.observe(el));
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
async function warmJumpToApprox(turn) {
  const sc = getScrollContainer();
  const y = PosCache.get(turn);
  if (typeof y !== "number") return false;
  sc.scrollTo({ top: clamp(y - sc.clientHeight * 0.45, 0, sc.scrollHeight), behavior: "auto" });
  await sleep(80);
  return !!getTurnEl(turn);
}
function countMessages() {
  return document.querySelectorAll(MSG_SEL).length;
}
async function findMessageByFingerprint(fingerprint) {
  for (const el of iterVisibleMessages()) {
    const norm = normalizeText(el.innerText || "").slice(0, HASH_HEAD);
    const fp = await sha1Hex(norm);
    if (fp === fingerprint) return el;
  }
  return null;
}
async function coarseScanTowards({ matchFn, direction = "up", steps = COARSE_STEPS }) {
  const sc = getScrollContainer();
  const delta = Math.floor(sc.clientHeight * 0.9) * (direction === "up" ? -1 : 1);
  for (let i = 0; i < steps; i++) {
    const hit = await matchFn();
    if (hit) return hit;
    sc.scrollTop += delta;
    await sleep(SCAN_PAUSE_MS);
  }
  return null;
}
function waitFor(cond, timeout = 6e3, interval = 80) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = async () => {
      try {
        if (await cond()) return resolve(true);
      } catch {
      }
      if (performance.now() - t0 > timeout) return resolve(false);
      setTimeout(tick, interval);
    };
    tick();
  });
}
async function pageUntilEdge({ matchFn, to = "up", maxPages = 40 }) {
  const sc = getScrollContainer();
  let pages = 0;
  while (pages < maxPages) {
    const hit = await matchFn();
    if (hit) return hit;
    const beforeH = sc.scrollHeight;
    const beforeC = countMessages();
    sc.scrollTop = to === "up" ? 0 : sc.scrollHeight;
    const ok = await waitFor(async () => {
      if (await matchFn()) return true;
      return sc.scrollHeight > beforeH || countMessages() > beforeC;
    }, 6e3, 80);
    pages++;
    if (!ok) break;
  }
  return matchFn();
}
function getVisibleTurnRange() {
  const els = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
  const turns = els.map((el) => {
    const m = el.getAttribute("data-testid")?.match(/conversation-turn-(\d+)/);
    return m ? parseInt(m[1], 10) : NaN;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  if (!turns.length) return null;
  return { min: turns[0], max: turns[turns.length - 1] };
}
function preferredDirectionForTurn(targetTurn) {
  const r = getVisibleTurnRange();
  if (!r) return "up";
  if (targetTurn < r.min) return "up";
  if (targetTurn > r.max) return "down";
  return null;
}
async function materializeTurn(targetTurn, { maxPages = 60 } = {}) {
  const sc = getScrollContainer();
  for (let i = 0; i < maxPages; i++) {
    const direct = getTurnEl(targetTurn);
    if (direct) return direct;
    const vis = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]')).map((el) => ({ el, turn: getTurn(el) })).filter((x) => Number.isInteger(x.turn)).sort((a, b) => (a.turn || 0) - (b.turn || 0));
    if (!vis.length) {
      await sleep(SCAN_PAUSE_MS);
      continue;
    }
    const min = vis[0].turn || 0;
    const max = vis[vis.length - 1].turn || 0;
    if (targetTurn >= min && targetTurn <= max) {
      const el = getTurnEl(targetTurn);
      if (el) return el;
      sc.scrollTop += 1;
      await sleep(SCAN_PAUSE_MS);
      const el2 = getTurnEl(targetTurn);
      if (el2) return el2;
    }
    const turnsPerScreen = Math.max(1, vis.length);
    const pageScreens = 0.9;
    let screens = 1;
    if (targetTurn < min) {
      const deficit = min - targetTurn;
      screens = Math.max(1, Math.ceil(deficit / turnsPerScreen));
      sc.scrollTop -= sc.clientHeight * pageScreens * screens;
    } else if (targetTurn > max) {
      const deficit = targetTurn - max;
      screens = Math.max(1, Math.ceil(deficit / turnsPerScreen));
      sc.scrollTop += sc.clientHeight * pageScreens * screens;
    } else {
      sc.scrollTop += sc.clientHeight * 0.25;
    }
    await sleep(SCAN_PAUSE_MS);
  }
  return null;
}
function resolveRangeByAnchor(rootEl, sel) {
  const { norm } = buildNormIndex(rootEl);
  if (Number.isFinite(sel.start) && Number.isFinite(sel.end) && sel.end > sel.start) {
    try {
      const r = rangeFromNormOffsets(rootEl, sel.start, sel.end);
      if (sel.anchor) {
        const winStart = Math.max(0, sel.start - sel.relStart);
        const slice = norm.slice(winStart, winStart + sel.anchor.length);
        if (slice === sel.anchor) return r;
      } else {
        return r;
      }
    } catch {
    }
  }
  if (sel.anchor && sel.anchor.length) {
    const pos = norm.indexOf(sel.anchor);
    if (pos >= 0) {
      const start = pos + (sel.relStart || 0);
      const end = start + (sel.len || Math.max(1, sel.end - sel.start));
      return rangeFromNormOffsets(rootEl, start, end);
    }
  }
  const fallbackStart = Number.isFinite(sel.start) ? sel.start : 0;
  const fallbackEnd = Math.max(fallbackStart + 1, Number.isFinite(sel.end) ? sel.end : fallbackStart + 1);
  return rangeFromNormOffsets(rootEl, clamp(fallbackStart, 0, norm.length - 1), clamp(fallbackEnd, 1, norm.length));
}
async function makeBookmarkFromSelection(note = "") {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const node = sel.anchorNode || sel.focusNode;
  const msgEl = node?.parentElement?.closest(MSG_SEL);
  if (!msgEl) return null;
  const { norm } = buildNormIndex(msgEl);
  const fingerprint = await sha1Hex(norm.slice(0, HASH_HEAD));
  const r = sel.getRangeAt(0);
  const map = buildNormIndex(msgEl).map;
  const rawSel = sel.toString();
  const normSel = normalizeText(rawSel);
  let startOffset = -1, endOffset = -1;
  if (normSel.length) {
    const idx = norm.indexOf(normSel);
    if (idx >= 0) {
      startOffset = idx;
      endOffset = idx + normSel.length;
    }
  }
  if (startOffset < 0 || endOffset < 0) {
    startOffset = 0;
    endOffset = 1;
  }
  const len = Math.max(1, endOffset - startOffset);
  const winStart = Math.max(0, startOffset - WIN_PRE);
  const winEnd = Math.min(norm.length, endOffset + WIN_POST);
  const anchor = norm.slice(winStart, winEnd);
  const anchorHash = await sha1Hex(anchor);
  const relStart = startOffset - winStart;
  const sample = norm.slice(Math.max(0, startOffset - 40), Math.min(norm.length, endOffset + 40));
  const turn = getTurn(msgEl) ?? void 0;
  return {
    // ID will be set by database after saving
    version: 3,
    chatId: extractChatId(),
    url: window.location.href,
    selectedText: rawSel,
    note,
    turn,
    tags: [],
    timestamp: /* @__PURE__ */ new Date(),
    isHighlighted: false,
    msg: { fingerprint, sample },
    selection: { start: startOffset, end: endOffset, len, anchor, anchorHash, relStart },
    createdAt: Date.now()
  };
}
async function saveBookmarkFromSelection(note = "") {
  try {
    const bookmarkId = await bookmarksService.createAndSaveBookmark(note, []);
    if (!bookmarkId) return null;
    const bm = await makeBookmarkFromSelection(note);
    if (!bm) return null;
    bm.id = bookmarkId;
    if (bm.turn != null) {
      const node = MapIndex.get(bm.turn) || { turn: bm.turn, role: "assistant" };
      node.hasBookmarks = true;
      node.bookmarks = node.bookmarks || [];
      node.bookmarks.push({
        id: String(bm.id),
        // Convert to string for display
        start: bm.selection?.start ?? 0,
        end: bm.selection?.end ?? 0,
        note: bm.note || ""
      });
      MapIndex.set(bm.turn, node);
      notifyTimelineChange();
    }
    return bm;
  } catch (error) {
    console.error("[ChatMapEngine] Error saving bookmark:", error);
    return null;
  }
}
async function jumpToBookmark(bm) {
  if (!bm || bm.chatId !== extractChatId()) return false;
  let el = null;
  if (Number.isInteger(bm.turn) && bm.turn !== void 0) await warmJumpToApprox(bm.turn);
  if (Number.isInteger(bm.turn) && bm.turn !== void 0) {
    el = getTurnEl(bm.turn) || await materializeTurn(bm.turn);
  }
  if (!el && bm.msg?.fingerprint) {
    const matchFn = () => findMessageByFingerprint(bm.msg.fingerprint);
    let dir = "up";
    if (Number.isInteger(bm.turn) && bm.turn !== void 0) {
      dir = preferredDirectionForTurn(bm.turn);
    } else {
      dir = "up";
    }
    el = await coarseScanTowards({ matchFn, direction: dir }) || await pageUntilEdge({ matchFn, to: dir }) || await coarseScanTowards({ matchFn, direction: dir === "up" ? "down" : "up" }) || await pageUntilEdge({ matchFn, to: dir === "up" ? "down" : "up" });
  }
  if (!el) return false;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  if (bm.selection) {
    const range = resolveRangeByAnchor(el, bm.selection);
    const rects = range.getClientRects();
    if (rects.length) {
      const sc = getScrollContainer();
      const rect = rects[0];
      const scRect = sc.getBoundingClientRect();
      const targetTop = sc.scrollTop + (rect.top - scRect.top) - sc.clientHeight / 2 + rect.height / 2;
      sc.scrollTo({ top: clamp(targetTop, 0, sc.scrollHeight), behavior: "auto" });
    }
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      setTimeout(() => sel?.removeAllRanges(), 300);
    }
  }
  flash(el);
  return true;
}
let EphemeralAnchorsEnabled = false;
function enableEphemeralAnchors(flag) {
  EphemeralAnchorsEnabled = !!flag;
}
async function installSilentAnchors() {
}
const MapIndex = /* @__PURE__ */ new Map();
let timelineListeners = /* @__PURE__ */ new Set();
function onTimelineChange(cb) {
  timelineListeners.add(cb);
  return () => timelineListeners.delete(cb);
}
function notifyTimelineChange() {
  timelineListeners.forEach((fn) => {
    try {
      fn(getMapNodes());
    } catch {
    }
  });
}
function upsertNodeFromElement(el, fp, bookmarksByFp) {
  const turn = getTurn(el);
  if (!Number.isInteger(turn) || turn === null) return;
  const raw = el.innerText || "";
  const norm = normalizeText(raw);
  const role = el.querySelector('div[data-message-author-role="user"], [data-testid*="user"]') ? "user" : "assistant";
  const node = MapIndex.get(turn) || { turn, role };
  node.fingerprint = fp;
  node.snippet = norm.slice(0, 120);
  node.hydrated = true;
  const bms = bookmarksByFp.get(fp) || [];
  node.hasBookmarks = bms.length > 0;
  node.bookmarks = bms.map((b) => ({ id: String(b.id || ""), start: b.selection?.start ?? 0, end: b.selection?.end ?? 0, note: b.note || "" }));
  MapIndex.set(turn, node);
  notifyTimelineChange();
}
function getMapNodes() {
  return Array.from(MapIndex.values()).sort((a, b) => a.turn - b.turn);
}
async function buildTimelineIndexFromDom() {
  const chatId = extractChatId();
  const bookmarks = await bookmarksService.getBookmarksForCurrentChat();
  const byFp = /* @__PURE__ */ new Map();
  for (const b of bookmarks) {
    if (b.msg?.fingerprint) {
      const arr = byFp.get(b.msg.fingerprint) || [];
      arr.push(b);
      byFp.set(b.msg.fingerprint, arr);
    }
  }
  for (const el of iterVisibleMessages()) {
    const norm = normalizeText(el.innerText || "").slice(0, HASH_HEAD);
    const fp = await sha1Hex(norm);
    upsertNodeFromElement(el, fp, byFp);
  }
}
async function onTimelineClick(turn, fingerprint, bookmark) {
  await warmJumpToApprox(turn);
  let el = getTurnEl(turn) || await materializeTurn(turn);
  if (!el && fingerprint) {
    const matchFn = () => findMessageByFingerprint(fingerprint);
    el = await coarseScanTowards({ matchFn, direction: "up" }) || await pageUntilEdge({ matchFn, to: "up" }) || await coarseScanTowards({ matchFn, direction: "down" }) || await pageUntilEdge({ matchFn, to: "down" });
  }
  if (!el) return false;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  if (bookmark) {
    const range = resolveRangeByAnchor(el, {
      start: bookmark.start,
      end: bookmark.end,
      len: Math.max(1, (bookmark.end || 0) - (bookmark.start || 0)),
      // Если передаёшь из полного bm — прокинь bm.selection.anchor/relStart
      anchor: bookmark.anchor,
      anchorHash: bookmark.anchorHash,
      relStart: bookmark.relStart
    });
    const rects = range.getClientRects();
    if (rects.length) {
      const sc = getScrollContainer();
      const rect = rects[0], scRect = sc.getBoundingClientRect();
      sc.scrollTo({ top: clamp(sc.scrollTop + (rect.top - scRect.top) - sc.clientHeight / 2, 0, sc.scrollHeight), behavior: "auto" });
    }
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      setTimeout(() => sel?.removeAllRanges(), 300);
    }
  }
  flash(el);
  return true;
}
async function init({ enableAnchors = false } = {}) {
  EphemeralAnchorsEnabled = !!enableAnchors;
  initEventListeners();
  if (!document.querySelector(MSG_SEL)) {
    await new Promise((res) => {
      const mo = new MutationObserver(() => {
        if (document.querySelector(MSG_SEL)) {
          mo.disconnect();
          res(true);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
  installPositionObserver();
  const list = await bookmarksService.getBookmarksForCurrentChat();
  await installSilentAnchors();
  await buildTimelineIndexFromDom();
}
function handleBookmarkDeleted(bookmarkId) {
  console.log("[ChatMapEngine] Handling UI updates for deleted bookmark:", bookmarkId);
  notifyTimelineChange();
}
function initEventListeners() {
  window.addEventListener("gpt-notes:bookmark-deleted", (event) => {
    const customEvent = event;
    const { bookmarkId } = customEvent.detail;
    handleBookmarkDeleted(bookmarkId);
  });
}
async function deleteBookmark(bookmarkId) {
  try {
    handleBookmarkDeleted(bookmarkId);
    return true;
  } catch (error) {
    console.error("[ChatMapEngine] Error handling bookmark deletion UI:", error);
    return false;
  }
}
export {
  init,
  enableEphemeralAnchors,
  saveBookmarkFromSelection,
  jumpToBookmark,
  deleteBookmark,
  getMapNodes,
  onTimelineChange,
  onTimelineClick,
  handleBookmarkDeleted,
  initEventListeners,
  materializeTurn,
  warmJumpToApprox,
  resolveRangeByAnchor
};
