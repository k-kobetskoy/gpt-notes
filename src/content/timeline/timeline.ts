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

// spacing - for connected timeline
const NODE_HEIGHT = 9;        // height of diamond node
const LINE_HEIGHT = 27;       // height of line segment  
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

// Icon creation utility - inline sprite approach
const SPRITE_PATH = chrome.runtime.getURL("src/content/assets/icons.svg");
const NODE_ICON_PATH = chrome.runtime.getURL("src/content/assets/node-icon.svg");
const SPRITE_ID = "__gpt_notes_sprite__";
const NODE_ICON_ID = "__gpt_notes_node_icon__";
const ICON_PREFIX = "gpt-notes-";

async function ensureSpriteInjected(): Promise<void> {
  if (document.getElementById(SPRITE_ID)) return;

  try {
    const response = await fetch(SPRITE_PATH);
    const text = await response.text();

    // Prefix IDs to avoid conflicts with the page
    const prefixed = text
      .replace(/id="([^"]+)"/g, (_, id) => `id="${ICON_PREFIX}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${ICON_PREFIX}${id})`);

    const doc = new DOMParser().parseFromString(prefixed, "image/svg+xml");
    const sprite = doc.documentElement; // <svg> with <symbol> inside
    sprite.id = SPRITE_ID;
    sprite.style.display = "none";

    // Inject into document head for global access
    document.documentElement.prepend(sprite);
    console.log('[Timeline Debug] SVG sprite injected successfully');
  } catch (error) {
    console.error('[Timeline Debug] Failed to inject SVG sprite:', error);
  }
}

async function ensureNodeIconInjected(): Promise<void> {
  if (document.getElementById(NODE_ICON_ID)) return;

  try {
    const response = await fetch(NODE_ICON_PATH);
    const text = await response.text();

    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const nodeIcon = doc.documentElement; // <svg> element
    nodeIcon.id = NODE_ICON_ID;
    nodeIcon.style.display = "none";

    // Inject into document head for global access
    document.documentElement.prepend(nodeIcon);
    console.log('[Timeline Debug] Node icon injected successfully');
  } catch (error) {
    console.error('[Timeline Debug] Failed to inject node icon:', error);
  }
}

function makeIcon(name: string, size = 16, label: string | null = null): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", size.toString());
  svg.setAttribute("height", size.toString());
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }

  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#${ICON_PREFIX}${name}`); // No chrome-extension:// URL needed
  svg.appendChild(use);
  return svg;
}

function makeNodeIcon(label: string | null = null): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "9");
  svg.setAttribute("height", "9");
  svg.setAttribute("viewBox", "0 0 9 9");
  svg.setAttribute("fill", "none");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }

  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "-0.734375");
  rect.setAttribute("y", "4.48633");
  rect.setAttribute("width", "7.29226");
  rect.setAttribute("height", "7.29226");
  rect.setAttribute("rx", "2");
  rect.setAttribute("transform", "rotate(-45 -0.734375 4.48633)");
  rect.setAttribute("fill", "currentColor");
  
  svg.appendChild(rect);
  return svg;
}

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
  // Target the main element directly
  const mainElement = document.querySelector<HTMLElement>('main');
  if (mainElement) {
    return mainElement;
  }
  
  // Fallback: look for conversation turns and climb up
  const firstTurn = document.querySelector<HTMLElement>('[data-testid^="conversation-turn-"]');
  if (!firstTurn) return null;

  return firstTurn.parentElement?.parentElement ?? null;
}

/** Measures header/padding above the first turn inside the host and anchors beneath it. */
function positionTimelineAgainst(host: HTMLElement) {
  if (!rootEl) return;

  const hostRect = host.getBoundingClientRect();
  
  // Find the page header to calculate its height
  const pageHeader = document.querySelector<HTMLElement>('#page-header, header[id="page-header"], .sticky.top-0');
  const headerHeight = pageHeader ? pageHeader.getBoundingClientRect().height : 0;


  // Place to the LEFT of the main element, outside, with margin
  const tlWidth = (rootEl.getBoundingClientRect().width || 28);
  const left = Math.max(0, hostRect.left - tlWidth + TL_MARGIN_X);

  // Top position: account for header height
  const top = Math.max(0, hostRect.top + headerHeight);
  
  // Height: from top position to bottom of host, minus screen bottom gap and header height
  const maxBottom = Math.min(hostRect.bottom, window.innerHeight - SCREEN_BOTTOM_GAP);
  const height = Math.max(120, maxBottom - top - headerHeight);

  rootEl.style.position = 'fixed';
  rootEl.style.left = `${left}px`;
  rootEl.style.top = `${top}px`;
  rootEl.style.bottom = 'auto';
  rootEl.style.height = `${height}px`;
  
}

function anchorOrHide() {
  const host = selectChatHost();
  if (!rootEl) {
    return;
  }
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
  // Create connected timeline: node->line->node->line...
  const turns = nodes.map(n => n.turn);
  const ys: number[] = [];

  let y = TOP_PAD;

  nodes.forEach((n, idx) => {
    ys.push(y);
    
    // Move to next position based on current element type
    if (n.role === 'user') {
      // User node: move down by node height (diamond is 9px tall)
      y += NODE_HEIGHT;
    } else {
      // Assistant line: move down by line height (line is 27px tall)
      y += LINE_HEIGHT;
    }
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
  canvas.style.position = 'relative';
  canvas.style.width = '100%';

  // Create timeline elements with new icon-based design
  currentNodes.forEach((n, i) => {
    const y = layoutYs[i];

    // Create container for the timeline element
    const elementContainer = document.createElement('div');
    elementContainer.className = `gpt-notes-tl__element gpt-notes-tl__element--${n.role}`;
    elementContainer.style.position = 'absolute';
    elementContainer.style.top = `${y}px`;
    elementContainer.style.left = '50%';
    elementContainer.style.transform = 'translateX(-50%)';

    // Create the appropriate element based on role
    let element: Element;
    if (n.role === 'user') {
      // User messages get dedicated node icons (questions) - 9x9 diamonds
      element = makeNodeIcon(`User message - turn ${n.turn}`);
      element.setAttribute('class', 'gpt-notes-tl__node');
    } else {
      // Assistant messages get CSS line boxes (answers) - 1x27 vertical lines  
      element = document.createElement('div');
      element.className = 'gpt-notes-tl__line';
      element.setAttribute('aria-label', `Assistant reply - turn ${n.turn}`);
      // CSS will handle the styling
    }

    elementContainer.appendChild(element);

    // Add event listeners
    elementContainer.addEventListener('mouseenter', (ev) => showTipForNode(ev as MouseEvent, n));
    elementContainer.addEventListener('mouseleave', hideTip);
    elementContainer.addEventListener('click', async (ev) => {
      ev.preventDefault(); 
      ev.stopPropagation();
      
      try {
        console.log('Timeline element clicked - turn:', n.turn, 'fingerprint:', n.fingerprint);
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

    canvas.appendChild(elementContainer);

    // Add bookmarks if any
    if (n.bookmarks?.length) {
      n.bookmarks.forEach((bm, idx) => {
        const bookmarkEl = document.createElement('div');
        bookmarkEl.className = 'gpt-notes-tl__bookmark';
        bookmarkEl.style.position = 'absolute';
        bookmarkEl.style.top = `${y + (idx * 8)}px`;
        bookmarkEl.style.left = '50%';
        bookmarkEl.style.transform = 'translateX(-50%)';
        bookmarkEl.style.width = '6px';
        bookmarkEl.style.height = '6px';
        bookmarkEl.style.backgroundColor = 'var(--bookmark-color, #ff6b35)';
        bookmarkEl.style.borderRadius = '50%';
        bookmarkEl.style.marginLeft = '8px'; // Offset from the main timeline

        bookmarkEl.addEventListener('mouseenter', (ev) => showTipForBookmark(ev as MouseEvent, n, bm));
        bookmarkEl.addEventListener('mouseleave', hideTip);
        bookmarkEl.addEventListener('click', async (ev) => {
          ev.preventDefault(); 
          ev.stopPropagation();
          await onTimelineClick(n.turn, n.fingerprint || '', {
            start: bm.start, end: bm.end,
            len: Math.max(1, (bm.end ?? 0) - (bm.start ?? 0)),
            anchor: (bm as any).anchor, anchorHash: (bm as any).anchorHash, relStart: (bm as any).relStart
          });
        });
        canvas.appendChild(bookmarkEl);
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
  // 1) Load assets (html + css themes) and inject SVG sprite
  const html = await loadAssets();
  applyThemeCss();
  const unwatch = watchThemeChanges();
  
  // Inject SVG sprite and node icon before creating timeline elements
  await ensureSpriteInjected();
  await ensureNodeIconInjected();

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
