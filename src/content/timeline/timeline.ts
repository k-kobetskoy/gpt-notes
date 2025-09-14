// Timeline (mounts left-rail UI by fetching external HTML & CSS themes)
'use strict';

import type { MapNode } from '../types'; // adjust relative path if needed
import {
  getMapNodes,
  onTimelineChange,
  onTimelineClick,
  warmJumpToApprox,
  materializeTurn,
} from '../chatMapEngine';

// ------------------------------
// Config
// ------------------------------
const PATH_HTML = 'src/content/timeline/timeline.html';
const PATH_CSS_LIGHT = 'src/content/timeline/timeline.light.css';
const PATH_CSS_DARK  = 'src/content/timeline/timeline.dark.css';

// spacing
const PAIR_GAP = 14;          // distance inside a Q/A pair (user -> assistant)
const BLOCK_GAP = 120;        // distance from an answer to the next question (assistant -> next user)
const TOP_PAD = 8;            // inner top padding inside the canvas
const INNER_BOTTOM_PAD = 24;  // inner bottom padding inside the canvas

// anchoring
const TL_MARGIN_X = 32;       // gap between chat pane and the timeline (outside its left edge)
const SCREEN_BOTTOM_GAP = 32; // gap between viewport bottom and timeline end (container height limit)

const TOOLTIP_MAX_W = 320;

type Disposer = () => void;

let rootEl: HTMLElement | null = null;
let tipEl: HTMLElement | null = null;
let containerEl: HTMLElement | null = null;
let unsub: Disposer | null = null;
let cssEl: HTMLStyleElement | null = null;

let currentNodes: MapNode[] = [];
let minTurn = 0;
let maxTurn = 0;

// layout cache
let layoutTurns: number[] = [];
let layoutYs: number[] = [];
let virtualH = 0;
let cachedCss: Record<'light'|'dark', string> = { light: '', dark: '' };

// ------------------------------
// Utilities
// ------------------------------
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const truncate = (s: string, n = 160) => !s ? '' : (s.trim().replace(/\s+/g,' ').slice(0, n) + (s.trim().length > n ? '…' : ''));

function computeTurns(nodes: MapNode[]) {
  const list = nodes.map(n => n.turn).filter(t => Number.isFinite(t)) as number[];
  if (!list.length) return { min: 0, max: 0 };
  return { min: Math.min(...list), max: Math.max(...list) };
}

function q<T extends Element = Element>(root: ParentNode, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

async function fetchText(path: string) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return await res.text();
}

function getScheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

async function loadAssets() {
  const [html, cssLight, cssDark] = await Promise.all([
    fetchText(PATH_HTML),
    fetchText(PATH_CSS_LIGHT),
    fetchText(PATH_CSS_DARK)
  ]);
  cachedCss.light = cssLight;
  cachedCss.dark = cssDark;
  return html;
}

function applyThemeCss() {
  const scheme = getScheme();
  if (!cssEl) {
    cssEl = document.createElement('style');
    cssEl.id = 'gpt-notes-timeline-style';
    document.head.appendChild(cssEl);
  }
  cssEl.textContent = cachedCss[scheme] || '';
}

function watchThemeChanges() {
  const m = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => applyThemeCss();
  if (typeof m.addEventListener === 'function') {
    m.addEventListener('change', handler);
    return () => m.removeEventListener('change', handler);
  }
  if (typeof (m as any).addListener === 'function') {
    (m as any).addListener(handler);
    return () => (m as any).removeListener(handler);
  }
  return () => {};
}

// ------------------------------
// Anchor to the chat column (avoid header overlap, keep bottom gap)
// ------------------------------
function selectChatHost(): HTMLElement | null {
  const mainWithTurns =
    document.querySelector<HTMLElement>('main:has([data-testid^="conversation-turn-"])') ||
    document.querySelector<HTMLElement>('[role="main"]:has([data-testid^="conversation-turn-"])')

  if (mainWithTurns) {
    console.log('[selectChatHost] mainWithTurns', mainWithTurns);
    return mainWithTurns;
  }

  const firstTurn = document.querySelector<HTMLElement>('[data-testid^="conversation-turn-"]');
  if (!firstTurn) return null;

  // climb to a reasonably wide container
  let el: HTMLElement | null = firstTurn.parentElement as HTMLElement | null;
  while (el && el.parentElement && el.getBoundingClientRect().width < (window.innerWidth * 0.35)) {
    el = el.parentElement as HTMLElement | null;
  }

  console.log('[selectChatHost] el', el);
  return el;
}

/** Measures header/padding above the first turn inside the host and anchors beneath it. */
function positionTimelineAgainst(host: HTMLElement) {
  if (!rootEl) return;

  const hostRect = host.getBoundingClientRect();
  const firstTurn = document.querySelector<HTMLElement>('[data-testid^="conversation-turn-"]');
  const firstTurnRect = firstTurn?.getBoundingClientRect();

  // Distance from host top to the first turn (treat as header height)
  const headerOffset = Math.max(0, (firstTurnRect ? (firstTurnRect.top - hostRect.top) : 0));

  // Place to the LEFT of the chat host, outside, with margin
  const tlWidth = (rootEl.getBoundingClientRect().width || 28);
  const left = Math.max(0, hostRect.left - tlWidth + TL_MARGIN_X);

  // Top is host.top + headerOffset; Height is limited by both host bottom and viewport bottom - SCREEN_BOTTOM_GAP
  const top = Math.max(0, hostRect.top + headerOffset);
  const maxBottom = Math.min(hostRect.bottom, window.innerHeight - SCREEN_BOTTOM_GAP);
  const height = Math.max(120, maxBottom - top); // keep at least some height

  rootEl.style.position = 'fixed';
  rootEl.style.left = `${left}px`;
  rootEl.style.top = `${top}px`;
  rootEl.style.bottom = 'auto';
  rootEl.style.height = `${height}px`;
}

function anchorOrHide() {
  const host = selectChatHost();
  if (!rootEl) return;
  if (!host) {
    rootEl.style.display = 'none';
    return;
  }
  rootEl.style.display = 'block';
  positionTimelineAgainst(host);
}

// ------------------------------
// Layout: fixed spacing (pair vs next question)
// ------------------------------
function buildLayout(nodes: MapNode[]) {
  // nodes are already per-turn sorted in getMapNodes()
  const turns = nodes.map(n => n.turn);
  const ys: number[] = [];

  let y = TOP_PAD;
  let prevRole: MapNode['role'] | null = null;

  nodes.forEach((n, idx) => {
    if (idx === 0) {
      // first message at TOP_PAD
      ys.push(y);
      prevRole = n.role;
      return;
    }

    if (n.role === 'assistant') {
      // same pair (close to user)
      y += PAIR_GAP;
    } else {
      // new question block (fixed distance from previous answer)
      y += BLOCK_GAP;
    }

    ys.push(y);
    prevRole = n.role;
  });

  const canvasH = y + INNER_BOTTOM_PAD;
  return { turns, ys, canvasH };
}

// ------------------------------
// Render
// ------------------------------
function clear(el: Element | null) { 
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild); 
}

function render() {
  if (!rootEl || !containerEl) {
    console.warn('Timeline elements not ready for render:', { rootEl: !!rootEl, containerEl: !!containerEl });
    return;
  }

  currentNodes = getMapNodes() || [];
  const { min, max } = computeTurns(currentNodes);
  minTurn = min; maxTurn = max;

  // Compute fixed layout
  const L = buildLayout(currentNodes);
  layoutTurns = L.turns;
  layoutYs = L.ys;
  virtualH = L.canvasH;

  const container = containerEl;
  const canvas = document.createElement('div');
  canvas.className = 'gpt-notes-tl__canvas';
  canvas.style.height = `${virtualH}px`;

  const rail = document.createElement('div');
  rail.className = 'gpt-notes-tl__rail';
  canvas.appendChild(rail);

  // dots + bookmarks
  currentNodes.forEach((n, i) => {
    const y = layoutYs[i];

    const dot = document.createElement('div');
    dot.className = `gpt-notes-tl__dot ${n.role === 'user' ? 'gpt-notes-tl__dot--user' : 'gpt-notes-tl__dot--assistant'}`;
    dot.style.top = `${y}px`;
    dot.addEventListener('mouseenter', (ev) => showTipForNode(ev as MouseEvent, n));
    dot.addEventListener('mouseleave', hideTip);
    dot.addEventListener('click', async (ev) => {
      ev.preventDefault(); 
      ev.stopPropagation();
      
      try {
        console.log('Timeline dot clicked - turn:', n.turn, 'fingerprint:', n.fingerprint);
        await warmJumpToApprox(n.turn);
        const ok = await onTimelineClick(n.turn, n.fingerprint || '', undefined);
        if (!ok) {
          console.log('onTimelineClick failed, trying materializeTurn');
          const el = await materializeTurn(n.turn);
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
          } else {
            console.warn('Failed to materialize turn:', n.turn);
          }
        }
      } catch (error) {
        console.error('Timeline click error:', error);
      }
    });
    canvas.appendChild(dot);

    if (n.bookmarks?.length) {
      n.bookmarks.forEach((bm, idx) => {
        const m = document.createElement('div');
        m.className = 'gpt-notes-tl__bm';
        m.style.top = `${y + (idx ? idx * 8 : 0)}px`;
        m.addEventListener('mouseenter', (ev) => showTipForBookmark(ev as MouseEvent, n, bm));
        m.addEventListener('mouseleave', hideTip);
        m.addEventListener('click', async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          await onTimelineClick(n.turn, n.fingerprint || '', {
            start: bm.start, end: bm.end,
            len: Math.max(1, (bm.end ?? 0) - (bm.start ?? 0)),
            anchor: (bm as any).anchor, anchorHash: (bm as any).anchorHash, relStart: (bm as any).relStart
          });
        });
        canvas.appendChild(m);
      });
    }
  });

  clear(container);
  container.appendChild(canvas);
}

function ensureTip() {
  if (!tipEl) {
    tipEl = document.getElementById('gpt-notes-tl-tip') as HTMLElement;
    // Ensure tooltip is properly positioned in the DOM
    if (tipEl && !tipEl.parentElement) {
      document.body.appendChild(tipEl);
    }
  }
}

function showTipForNode(ev: MouseEvent, n: MapNode) {
  ensureTip(); 
  if (!tipEl || !rootEl) {
    console.warn('Tooltip elements not found:', { tipEl: !!tipEl, rootEl: !!rootEl });
    return;
  }
  
  const role = n.role === 'user' ? 'User message' : 'Assistant reply';
  const count = n.bookmarks?.length || 0;
  tipEl.innerHTML = `
    <div class="tt-head">${role}${count ? ` • ${count} bookmark${count>1?'s':''}` : ''} • turn ${n.turn}</div>
    <div class="tt-body">${truncate(n.snippet || '', 220)}</div>
  `;
  positionTip(ev.clientX, ev.clientY);
  tipEl.style.display = 'block';
  console.log('Tooltip shown for node:', n.turn);
}

function showTipForBookmark(ev: MouseEvent, n: MapNode, bm: any) {
  ensureTip(); 
  if (!tipEl || !rootEl) {
    console.warn('Tooltip elements not found for bookmark:', { tipEl: !!tipEl, rootEl: !!rootEl });
    return;
  }
  
  const range = `${bm.start ?? 0}-${bm.end ?? 0}`;
  const note = (bm.note || '').trim();
  tipEl.innerHTML = `
    <div class="tt-head">Bookmark • turn ${n.turn} • ${range}</div>
    <div class="tt-body">${truncate(n.snippet || '', 200)}</div>
    ${note ? `<div class="tt-note">${truncate(note, 180)}</div>` : ''}
  `;
  positionTip(ev.clientX, ev.clientY);
  tipEl.style.display = 'block';
  console.log('Bookmark tooltip shown for turn:', n.turn);
}

function positionTip(x: number, y: number) {
  if (!tipEl || !rootEl) return;
  const r = rootEl.getBoundingClientRect();
  const pad = 8;
  
  // Position to the right of the timeline with some spacing
  const left = r.right + 12;
  
  // Clamp vertical position to stay within viewport
  const tipHeight = tipEl.offsetHeight || 100; // estimate if not rendered yet
  const maxTop = window.innerHeight - tipHeight - pad;
  const top = clamp(y - tipHeight / 2, pad, maxTop);
  
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}
function hideTip() { 
  if (tipEl) {
    tipEl.style.display = 'none';
    console.log('Tooltip hidden');
  }
}

// ------------------------------
// Mount / Unmount
// ------------------------------
export async function mountTimeline() {
  // 1) Load assets (html + css themes)
  const html = await loadAssets();
  applyThemeCss();
  const unwatch = watchThemeChanges();

  // 2) Mount HTML once
  if (!document.getElementById('gpt-notes-tl')) {
    console.log('Mounting timeline HTML...');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    console.log('HTML to be inserted:', html);
    console.log('Parsed elements:', tmp.children.length);
    
    while (tmp.firstElementChild) {
      const element = tmp.firstElementChild;
      console.log('Appending element:', element.tagName, element.className);
      document.body.appendChild(element);
    }
    
    // Give the DOM a moment to update
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log('HTML mounting complete');
  }

  rootEl = document.getElementById('gpt-notes-tl') as HTMLElement;
  tipEl  = document.getElementById('gpt-notes-tl-tip') as HTMLElement;
  
  // Debug the container element selection
  console.log('rootEl found:', !!rootEl);
  if (rootEl) {
    console.log('rootEl innerHTML:', rootEl.innerHTML);
    console.log('Looking for .gpt-notes-tl__container in:', rootEl);
    containerEl = q(rootEl, '.gpt-notes-tl__container') as HTMLElement;
    console.log('containerEl found:', !!containerEl);
    
    // Try alternative selectors if the first one fails
    if (!containerEl) {
      console.log('Trying alternative selector...');
      containerEl = rootEl.querySelector('.gpt-notes-tl__container') as HTMLElement;
      console.log('Alternative selector result:', !!containerEl);
      
      // If still not found, create the missing container structure
      if (!containerEl) {
        console.log('Container not found, creating missing structure...');
        const panel = rootEl.querySelector('.gpt-notes-tl__panel');
        const railwrap = rootEl.querySelector('.gpt-notes-tl__railwrap');
        
        if (panel && railwrap) {
          containerEl = document.createElement('div');
          containerEl.className = 'gpt-notes-tl__container';
          railwrap.appendChild(containerEl);
          console.log('Created container element:', !!containerEl);
        }
      }
    }
  }
  
  console.log('Timeline elements initialized:', { 
    rootEl: !!rootEl, 
    tipEl: !!tipEl, 
    containerEl: !!containerEl 
  });

  // Ensure all required elements exist before proceeding
  if (!rootEl || !tipEl || !containerEl) {
    console.error('Failed to initialize timeline elements:', { rootEl: !!rootEl, tipEl: !!tipEl, containerEl: !!containerEl });
    return () => {}; // return empty disposer
  }

  // Anchor to chat window (initial)
  anchorOrHide();

  // Keep it aligned on resize / scroll / layout shifts
  const host = selectChatHost();
  const roHost = host ? new ResizeObserver(() => anchorOrHide()) : null;
  host && roHost!.observe(host);

  const roWin = new ResizeObserver(() => anchorOrHide());
  roWin.observe(document.documentElement);

  const onScroll = () => anchorOrHide();
  window.addEventListener('scroll', onScroll, { passive: true });

  const mo = new MutationObserver(() => anchorOrHide());
  mo.observe(document.body, { attributes: true, childList: true, subtree: true });

  // 3) Initial render & subscribe
  render();
  unsub = onTimelineChange(() => { render(); anchorOrHide(); });

  // 4) Re-render on container resize
  const ro = new ResizeObserver(() => { render(); anchorOrHide(); });
  ro.observe(rootEl);

  // Return disposer
  return function unmount() {
    try { unsub?.(); } catch {}
    unsub = null;
    ro.disconnect();
    roHost?.disconnect();
    roWin.disconnect();
    mo.disconnect();
    window.removeEventListener('scroll', onScroll);
    if (rootEl?.parentElement) rootEl.parentElement.removeChild(rootEl);
    if (tipEl?.parentElement) tipEl.parentElement.removeChild(tipEl);
    if (cssEl?.parentElement) cssEl.parentElement.removeChild(cssEl);
    rootEl = tipEl = containerEl = cssEl = null;
    unwatch?.();
  };
}
