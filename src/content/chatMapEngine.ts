// chatMapEngine.ts — ES Module for Chrome content-script
'use strict';

import { bookmarksService } from './services/BookmarksService';
import type { Bookmark, MapNode, NormIndex } from './types';
import { 
  extractChatId,
  normalizeText, 
  sha1Hex, 
  getTurn, 
  getTurnEl,
  HASH_HEAD,
  WIN_PRE,
  WIN_POST,
  MSG_SEL,
  TURN_RE
} from './utils';

// ===========================
// CONFIG / SELECTORS
// ===========================
const SCAN_PAUSE_MS = 60;
const COARSE_STEPS = 8;

// Types are now imported from ./types.ts

// ===========================
// UTILS
// ===========================
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

// Utility functions now imported from ./utils

// getChatIdFromUrl replaced with extractChatId from utils

function getScrollContainer(): Element {
    let best = document.scrollingElement || document.documentElement;
    document.querySelectorAll('*').forEach(n => {
        const s = getComputedStyle(n);
        if (/(auto|scroll)/.test(s.overflowY) && (n as HTMLElement).scrollHeight > (n as HTMLElement).clientHeight) {
            if ((n as HTMLElement).scrollHeight > (best as HTMLElement).scrollHeight) best = n;
        }
    });
    return best as Element;
}

// getTurn and getTurnEl functions now imported from ./utils

function iterVisibleMessages(): Element[] {
    return Array.from(document.querySelectorAll(MSG_SEL));
}

function flash(el: HTMLElement): void {
    el.style.transition = 'box-shadow .65s ease';
    el.style.boxShadow = '0 0 0 3px rgba(180,200,255,.9)';
    setTimeout(() => el.style.boxShadow = '', 700);
}

// ===========================
// НОРМАЛИЗАЦИЯ ↔ DOM-ИНДЕКС
// ===========================
// точный индексатор: строим нормализованную строку сообщения и массив соответствий normIndex -> (node, rawOffset)
const NormCache = new WeakMap<Element, NormIndex>();

function isVisible(el: Element): boolean {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function buildNormIndex(rootEl: Element): NormIndex {
    const cached = NormCache.get(rootEl);
    if (cached) return cached;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    let norm = '';
    const map = [];

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement || node.parentNode;
        if (!(parent instanceof Element) || !isVisible(parent)) continue;

        const inPre = !!parent.closest('pre, code');
        const raw = node.textContent || '';

        if (inPre) {
            for (let i = 0; i < raw.length; i++) {
                norm += raw[i];
                map.push({ node, rawOffset: i });
            }
        } else {
            for (let i = 0; i < raw.length;) {
                if (/\s/.test(raw[i])) {
                    let j = i; while (j < raw.length && /\s/.test(raw[j])) j++;
                    if (norm && norm[norm.length - 1] !== ' ') {
                        norm += ' ';
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

function rangeFromNormOffsets(rootEl: Element, start: number, end: number): Range {
    const { map } = buildNormIndex(rootEl);
    const s = clamp(start, 0, Math.max(0, map.length - 1));
    const e = clamp(Math.max(end, s + 1), 1, map.length);
    const r = document.createRange();
    r.setStart(map[s].node, map[s].rawOffset);
    r.setEnd(map[e - 1].node, map[e - 1].rawOffset);
    return r;
}

// ===========================
// POSITION CACHE (warm jump)
// ===========================
const PosCache = new Map<number, number>(); // turn -> approxTop

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
            const top = (sc as HTMLElement).scrollTop + (rect.top - scRect.top);
            PosCache.set(turn!, top);

            const node = MapIndex.get(turn!);
            if (node) { node.approxTop = top; MapIndex.set(turn!, node); }
        }
    }, { root: sc, threshold: 0 });

    const hook = (root = document) => root.querySelectorAll(MSG_SEL).forEach(el => io.observe(el));
    hook(document);

    new MutationObserver((muts: MutationRecord[]) => {
        for (const m of muts) {
            for (const n of Array.from(m.addedNodes)) {
                if (!(n instanceof Element)) continue;
                (n.matches?.(MSG_SEL) ? [n] : Array.from(n.querySelectorAll?.(MSG_SEL) || [])).forEach((el: Element) => io.observe(el));
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}

async function warmJumpToApprox(turn: number): Promise<boolean> {
    const sc = getScrollContainer() as HTMLElement;
    const y = PosCache.get(turn);
    if (typeof y !== 'number') return false;
    sc.scrollTo({ top: clamp(y - sc.clientHeight * 0.45, 0, sc.scrollHeight), behavior: 'auto' });
    await sleep(80);
    return !!getTurnEl(turn);
}

// ===========================
// MATERIALIZATION / SCAN
// ===========================
function countMessages(): number {
    return document.querySelectorAll(MSG_SEL).length;
}

async function findMessageByFingerprint(fingerprint: string): Promise<Element | null> {
    for (const el of iterVisibleMessages()) {
        const norm = normalizeText((el as HTMLElement).innerText || '').slice(0, HASH_HEAD);
        const fp = await sha1Hex(norm);
        if (fp === fingerprint) return el;
    }
    return null;
}

async function coarseScanTowards({ matchFn, direction = 'up', steps = COARSE_STEPS }: { matchFn: () => Promise<Element | null>, direction?: 'up' | 'down', steps?: number }): Promise<Element | null> {
    const sc = getScrollContainer() as HTMLElement;
    const delta = Math.floor(sc.clientHeight * 0.9) * (direction === 'up' ? -1 : 1);
    for (let i = 0; i < steps; i++) {
        const hit = await matchFn();
        if (hit) return hit;
        sc.scrollTop += delta;
        await sleep(SCAN_PAUSE_MS);
    }
    return null;
}

function waitFor(cond: () => Promise<boolean>, timeout = 6000, interval = 80): Promise<boolean> {
    return new Promise(resolve => {
        const t0 = performance.now();
        const tick = async () => {
            try { if (await cond()) return resolve(true); } catch { }
            if (performance.now() - t0 > timeout) return resolve(false);
            setTimeout(tick, interval);
        };
        tick();
    });
}

async function pageUntilEdge({ matchFn, to = 'up', maxPages = 40 }: { matchFn: () => Promise<Element | null>, to?: 'up' | 'down', maxPages?: number }): Promise<Element | null> {
    const sc = getScrollContainer() as HTMLElement;
    let pages = 0;
    while (pages < maxPages) {
        const hit = await matchFn();
        if (hit) return hit;

        const beforeH = sc.scrollHeight;
        const beforeC = countMessages();
        sc.scrollTop = (to === 'up') ? 0 : sc.scrollHeight;

        const ok = await waitFor(async () => {
            if (await matchFn()) return true;
            return sc.scrollHeight > beforeH || countMessages() > beforeC;
        }, 6000, 80);

        pages++;
        if (!ok) break;
    }
    return matchFn();
}

function getVisibleTurnRange() {
    const els = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
    const turns = els.map(el => {
        const m = el.getAttribute('data-testid')?.match(/conversation-turn-(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
    }).filter(Number.isFinite).sort((a, b) => a - b);
    if (!turns.length) return null;
    return { min: turns[0], max: turns[turns.length - 1] };
}

// Куда начинать скан по известному turn
function preferredDirectionForTurn(targetTurn: number) {
    const r = getVisibleTurnRange();
    if (!r) return 'up';               // дефолт: вверх (старые выше)
    if (targetTurn < r.min) return 'up';
    if (targetTurn > r.max) return 'down';
    return null;                       // уже в диапазоне — скан не нужен
}


async function materializeTurn(targetTurn: number, { maxPages = 60 } = {}): Promise<Element | null> {
    const sc = getScrollContainer() as HTMLElement;
    for (let i = 0; i < maxPages; i++) {
        const direct = getTurnEl(targetTurn);
        if (direct) return direct;

        const vis = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'))
            .map(el => ({ el, turn: getTurn(el) }))
            .filter(x => Number.isInteger(x.turn))
            .sort((a, b) => (a.turn || 0) - (b.turn || 0));

        if (!vis.length) { await sleep(SCAN_PAUSE_MS); continue; }

        const min = vis[0].turn || 0;
        const max = vis[vis.length - 1].turn || 0;

        if (targetTurn >= min && targetTurn <= max) {
            const el = getTurnEl(targetTurn);
            if (el) return el;
            sc.scrollTop += 1; await sleep(SCAN_PAUSE_MS);
            const el2 = getTurnEl(targetTurn);
            if (el2) return el2;
        }

        const turnsPerScreen = Math.max(1, vis.length);
        const pageScreens = 0.9;
        let screens = 1;

        if (targetTurn < min) {
            const deficit = min - targetTurn;
            screens = Math.max(1, Math.ceil(deficit / turnsPerScreen));
            (sc as HTMLElement).scrollTop -= (sc as HTMLElement).clientHeight * pageScreens * screens;
        } else if (targetTurn > max) {
            const deficit = targetTurn - max;
            screens = Math.max(1, Math.ceil(deficit / turnsPerScreen));
            (sc as HTMLElement).scrollTop += (sc as HTMLElement).clientHeight * pageScreens * screens;
        } else {
            (sc as HTMLElement).scrollTop += (sc as HTMLElement).clientHeight * 0.25;
        }

        await sleep(SCAN_PAUSE_MS);
    }
    return null;
}

// ===========================
// РЕЗОЛВЕР ПО "АНКОРНОМУ ОКНУ"
// ===========================
function resolveRangeByAnchor(rootEl: Element, sel: any): Range {
    // sel: { start, end, len, anchor, anchorHash, relStart }
    const { norm } = buildNormIndex(rootEl);

    // 1) Прямо по сохранённым offsets (быстрее всего)
    if (Number.isFinite(sel.start) && Number.isFinite(sel.end) && sel.end > sel.start) {
        try {
            const r = rangeFromNormOffsets(rootEl, sel.start, sel.end);
            // быстрая верификация: окно встало туда же?
            if (sel.anchor) {
                const winStart = Math.max(0, sel.start - sel.relStart);
                const slice = norm.slice(winStart, winStart + sel.anchor.length);
                if (slice === sel.anchor) return r; // всё совпало
            } else {
                return r;
            }
        } catch { }
    }

    // 2) По "якорному окну" (строка сохранена, без вычисления контекстов)
    if (sel.anchor && sel.anchor.length) {
        const pos = norm.indexOf(sel.anchor);
        if (pos >= 0) {
            const start = pos + (sel.relStart || 0);
            const end = start + (sel.len || Math.max(1, sel.end - sel.start));
            return rangeFromNormOffsets(rootEl, start, end);
        }
    }

    // 3) fallback: если окна нет, но есть длина — хоть начало сообщения
    const fallbackStart = Number.isFinite(sel.start) ? sel.start : 0;
    const fallbackEnd = Math.max(fallbackStart + 1, Number.isFinite(sel.end) ? sel.end : fallbackStart + 1);
    return rangeFromNormOffsets(rootEl, clamp(fallbackStart, 0, norm.length - 1), clamp(fallbackEnd, 1, norm.length));
}

// ===========================
// BOOKMARKS: create / save / jump
// ===========================
async function makeBookmarkFromSelection(note = ''): Promise<Bookmark | null> {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;

    const node = sel.anchorNode || sel.focusNode;
    const msgEl = node?.parentElement?.closest(MSG_SEL);
    if (!msgEl) return null;

    // нормализованный текст сообщения
    const { norm } = buildNormIndex(msgEl);
    const fingerprint = await sha1Hex(norm.slice(0, HASH_HEAD));

    // точные норм-оффсеты
    const r = sel.getRangeAt(0);
    // посчитаем через TreeWalker+норм индексацию для идеальной точности
    // делаем временный Range→строку и ищем её в норме, если прямой оффсет не хотим строить вручную:
    // но у нас уже есть индекс, строим напрямую:
    // Чтобы получить норм-индексы, пробежимся map'ом:
    const map = buildNormIndex(msgEl).map; // not exported; use returned object
    // у нас нет обратной мапы (raw->norm), поэтому пойдём через текст выделения и indexOf:
    const rawSel = sel.toString();
    const normSel = normalizeText(rawSel);
    let startOffset = -1, endOffset = -1;

    if (normSel.length) {
        const idx = norm.indexOf(normSel);
        if (idx >= 0) { startOffset = idx; endOffset = idx + normSel.length; }
    }
    // если не нашли по тексту (например, 1 символ и пробелы схлопнулись) — построим приблизительно
    if (startOffset < 0 || endOffset < 0) {
        // грубый путь: возьмём начало сообщения
        startOffset = 0;
        endOffset = 1;
    }

    const len = Math.max(1, endOffset - startOffset);

    // АНКОРНОЕ ОКНО (сохраняем строку + хэш сразу)
    const winStart = Math.max(0, startOffset - WIN_PRE);
    const winEnd = Math.min(norm.length, endOffset + WIN_POST);
    const anchor = norm.slice(winStart, winEnd);
    const anchorHash = await sha1Hex(anchor);
    const relStart = startOffset - winStart;

    const sample = norm.slice(Math.max(0, startOffset - 40), Math.min(norm.length, endOffset + 40));
    const turn = getTurn(msgEl) ?? undefined;

    return {
        // ID will be set by database after saving
        version: 3,
        chatId: extractChatId(),
        url: window.location.href,
        selectedText: rawSel,
        note,
        turn,
        tags: [],
        timestamp: new Date(),
        isHighlighted: false,
        msg: { fingerprint, sample },
        selection: { start: startOffset, end: endOffset, len, anchor, anchorHash, relStart },
        createdAt: Date.now()
    };
}

async function saveBookmarkFromSelection(note = ''): Promise<Bookmark | null> {
    try {
        // Use BookmarksService for creation and saving
        const bookmarkId = await bookmarksService.createAndSaveBookmark(note, []);
        
        if (!bookmarkId) return null;

        // Create bookmark object for UI updates
        const bm = await makeBookmarkFromSelection(note);
        if (!bm) return null;
        
        // Set the database ID
        bm.id = bookmarkId;

        // Update timeline/map index
        if (bm.turn != null) {
            const node = MapIndex.get(bm.turn) || { turn: bm.turn, role: 'assistant' };
            node.hasBookmarks = true;
            node.bookmarks = node.bookmarks || [];
            node.bookmarks.push({
                id: String(bm.id), // Convert to string for display
                start: bm.selection?.start ?? 0,
                end: bm.selection?.end ?? 0,
                note: bm.note || ''
            });
            MapIndex.set(bm.turn, node);
            notifyTimelineChange();
        }
        return bm;
    } catch (error) {
        console.error('[ChatMapEngine] Error saving bookmark:', error);
        return null;
    }
}

async function jumpToBookmark(bm: Bookmark): Promise<boolean> {
    if (!bm || bm.chatId !== extractChatId()) return false;

    let el = null;

    if (Number.isInteger(bm.turn) && bm.turn !== undefined) await warmJumpToApprox(bm.turn);
    
    if (Number.isInteger(bm.turn) && bm.turn !== undefined) {
        el = getTurnEl(bm.turn) || await materializeTurn(bm.turn);
    }
    if (!el && bm.msg?.fingerprint) {
        const matchFn = () => findMessageByFingerprint(bm.msg!.fingerprint);

        // попробуем угадать направление из turn, если он есть
        let dir = 'up' as 'up' | 'down';
        if (Number.isInteger(bm.turn) && bm.turn !== undefined) {
            dir = preferredDirectionForTurn(bm.turn) as 'up' | 'down';
        } else {
            // когда turn неизвестен: симметричный план (немного вверх, потом вниз)
            // первая попытка — вверх:
            dir = 'up' as 'up' | 'down';
        }

        el = await coarseScanTowards({ matchFn, direction: dir })
            || await pageUntilEdge({ matchFn, to: dir })
            || await coarseScanTowards({ matchFn, direction: (dir === 'up' ? 'down' : 'up') })
            || await pageUntilEdge({ matchFn, to: (dir === 'up' ? 'down' : 'up') });

    }
    if (!el) return false;

    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

    if (bm.selection) {
        const range = resolveRangeByAnchor(el, bm.selection);
        // прокрутка к точному месту
        const rects = range.getClientRects();
        if (rects.length) {
            const sc = getScrollContainer();
            const rect = rects[0];
            const scRect = sc.getBoundingClientRect();
            const targetTop = sc.scrollTop + (rect.top - scRect.top) - (sc.clientHeight / 2) + rect.height / 2;
            sc.scrollTo({ top: clamp(targetTop, 0, sc.scrollHeight), behavior: 'auto' });
        }
        // короткая подсветка выделением
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            setTimeout(() => sel?.removeAllRanges(), 300);
        }
    }

    flash(el as HTMLElement);
    return true;
}

// ===========================
// SILENT ANCHORS (опционально, OFF)
// ===========================
let EphemeralAnchorsEnabled = false;
function enableEphemeralAnchors(flag: boolean): void { EphemeralAnchorsEnabled = !!flag; }
async function installSilentAnchors(): Promise<void> { /* ничего не вставляем — "тихий" режим */ }

// ===========================
// CHAT MAP / TIMELINE INDEX
// ===========================
const MapIndex = new Map<number, MapNode>();
let timelineListeners = new Set<(nodes: MapNode[]) => void>();
function onTimelineChange(cb: (nodes: MapNode[]) => void): () => boolean { timelineListeners.add(cb); return () => timelineListeners.delete(cb); }
function notifyTimelineChange(): void { timelineListeners.forEach((fn: any) => { try { fn(getMapNodes()); } catch { } }); }

function upsertNodeFromElement(el: Element, fp: string, bookmarksByFp: Map<string, Bookmark[]>): void {
    const turn = getTurn(el);
    if (!Number.isInteger(turn) || turn === null) return;
    const raw = (el as HTMLElement).innerText || '';
    const norm = normalizeText(raw);
    const role = el.querySelector('div[data-message-author-role="user"], [data-testid*="user"]') ? 'user' : 'assistant';

    const node: MapNode = MapIndex.get(turn) || { turn, role };
    node.fingerprint = fp;
    node.snippet = norm.slice(0, 120);
    node.hydrated = true;

    const bms = bookmarksByFp.get(fp) || [];
    node.hasBookmarks = bms.length > 0;
    node.bookmarks = bms.map((b: Bookmark) => ({ id: String(b.id || ''), start: b.selection?.start ?? 0, end: b.selection?.end ?? 0, note: b.note || '' }));

    MapIndex.set(turn, node);
    notifyTimelineChange();
}

function getMapNodes(): MapNode[] { return Array.from(MapIndex.values()).sort((a, b) => a.turn - b.turn); }

async function buildTimelineIndexFromDom() {
    const chatId = extractChatId();
    const bookmarks = await bookmarksService.getBookmarksForCurrentChat();
    const byFp = new Map();
    for (const b of bookmarks) {
        if (b.msg?.fingerprint) {
            const arr = byFp.get(b.msg.fingerprint) || [];
            arr.push(b);
            byFp.set(b.msg.fingerprint, arr);
        }
    }
    for (const el of iterVisibleMessages()) {
        const norm = normalizeText((el as HTMLElement).innerText || '').slice(0, HASH_HEAD);
        const fp = await sha1Hex(norm);
        upsertNodeFromElement(el, fp, byFp);
    }
}

async function onTimelineClick(turn: number, fingerprint: string, bookmark: any): Promise<boolean> {
    await warmJumpToApprox(turn);
    let el = getTurnEl(turn) || await materializeTurn(turn);
    if (!el && fingerprint) {
        const matchFn = () => findMessageByFingerprint(fingerprint);
        el = await coarseScanTowards({ matchFn, direction: 'up' })
            || await pageUntilEdge({ matchFn, to: 'up' })
            || await coarseScanTowards({ matchFn, direction: 'down' })
            || await pageUntilEdge({ matchFn, to: 'down' });
    }
    if (!el) return false;

    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

    if (bookmark) {
        const range = resolveRangeByAnchor(el, {
            start: bookmark.start, end: bookmark.end,
            len: Math.max(1, (bookmark.end || 0) - (bookmark.start || 0)),
            // Если передаёшь из полного bm — прокинь bm.selection.anchor/relStart
            anchor: bookmark.anchor, anchorHash: bookmark.anchorHash, relStart: bookmark.relStart
        });
        const rects = range.getClientRects();
        if (rects.length) {
            const sc = getScrollContainer();
            const rect = rects[0], scRect = sc.getBoundingClientRect();
            sc.scrollTo({ top: clamp(sc.scrollTop + (rect.top - scRect.top) - sc.clientHeight / 2, 0, sc.scrollHeight), behavior: 'auto' });
        }
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
            setTimeout(() => sel?.removeAllRanges(), 300);
        }
    }
    flash(el as HTMLElement);
    return true;
}

// ===========================
// INIT
// ===========================
async function init({ enableAnchors = false } = {}): Promise<void> {
    EphemeralAnchorsEnabled = !!enableAnchors;

    // Initialize event listeners for UI updates
    initEventListeners();

    if (!document.querySelector(MSG_SEL)) {
        await new Promise(res => {
            const mo = new MutationObserver(() => {
                if (document.querySelector(MSG_SEL)) { mo.disconnect(); res(true); }
            });
            mo.observe(document.body, { childList: true, subtree: true });
        });
    }

    installPositionObserver();

    const list = await bookmarksService.getBookmarksForCurrentChat();
    await installSilentAnchors();
    await buildTimelineIndexFromDom();
}

// Handle bookmark deletion UI updates (called via events)
function handleBookmarkDeleted(bookmarkId: number): void {
    console.log('[ChatMapEngine] Handling UI updates for deleted bookmark:', bookmarkId);
    
    // Update timeline after successful deletion
    notifyTimelineChange();
    }

// Initialize event listener for bookmark deletions
function initEventListeners(): void {
    window.addEventListener('gpt-notes:bookmark-deleted', (event: Event) => {
        const customEvent = event as CustomEvent;
        const { bookmarkId } = customEvent.detail;
        handleBookmarkDeleted(bookmarkId);
    });
}

// UI-only deletion handler
async function deleteBookmark(bookmarkId: number): Promise<boolean> {
    try {
        // Just handle UI updates - deletion is handled by BookmarksService
        handleBookmarkDeleted(bookmarkId);
        return true;
    } catch (error) {
        console.error('[ChatMapEngine] Error handling bookmark deletion UI:', error);
        return false;
    }
}

export {
    // lifecycle
    init, enableEphemeralAnchors,

    // bookmarks
    saveBookmarkFromSelection,
    jumpToBookmark,
    deleteBookmark, // UI-only deletion handler

    // timeline / map
    getMapNodes,
    onTimelineChange,
    onTimelineClick,

    // UI event handlers
    handleBookmarkDeleted,
    initEventListeners,

    // low-level
    materializeTurn,
    warmJumpToApprox,
    resolveRangeByAnchor,
};
