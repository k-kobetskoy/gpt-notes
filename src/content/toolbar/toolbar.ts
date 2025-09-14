import { bookmarksService } from '../services/BookmarksService';

export class BookmarksToolbar {
  private currentSelection: Selection | null = null;
  private toolbarHost: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private ignoreClicksUntilMs: number = 0;

  constructor() {
    this.createToolbarHost().then(() => {
      this.initializeEventListeners();
    });
  }

  createToolbarHost = async () => {
    // Host attaches to body
    this.toolbarHost = document.createElement("div");
    this.toolbarHost.id = "gpt-notes-host";
    document.body.appendChild(this.toolbarHost);

    // Create shadow root
    this.shadowRoot = this.toolbarHost.attachShadow({ mode: "open" });

    try {
      const [cssResponse, htmlResponse] = await Promise.all([
        fetch(chrome.runtime.getURL('src/content/toolbar/toolbar.css')),
        fetch(chrome.runtime.getURL('src/content/toolbar/toolbar.html'))
      ]);

      const cssText = await cssResponse.text();
      const htmlText = await htmlResponse.text();

      this.shadowRoot.innerHTML = `<style>${cssText}</style>${htmlText}`;
    } catch (error) {
      console.error('Failed to load toolbar assets:', error);     
    }
  }

  private getToolbarEl(): HTMLElement | null {
    return this.shadowRoot?.getElementById("toolbar") as HTMLElement | null;
  }

  private showToolbar = (x: number, y: number) => {
    const el = this.getToolbarEl();
    if (!el) return;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.display = "flex";
  }

  private hideToolbar = () => {
    const el = this.getToolbarEl();
    if (el) el.style.display = "none";
  }

  // Example: show toolbar after selection
  private initializeEventListeners = () => {
    document.addEventListener("mouseup", () => {
      const sel = window.getSelection();
      
      if (!sel || sel.isCollapsed) {
        this.hideToolbar();
        return;
      }
      this.currentSelection = sel;
      
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      
      this.showToolbar(rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
    });

    document.addEventListener('mousedown', (e) => {
      if (Date.now() < this.ignoreClicksUntilMs) {
        return;
      }
      
      const path = (e.composedPath && e.composedPath()) || [];
      const insideToolbar = this.toolbarHost ? path.includes(this.toolbarHost) : false;
      if (!insideToolbar) {
        this.hideToolbar();
      }
    }, true);
    
    
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this), true);
    
    
    // Handle toolbar save button clicks
    this.shadowRoot?.addEventListener('click', (e) => {
      if (Date.now() < this.ignoreClicksUntilMs) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      const target = e.target as HTMLElement;
      if (target.id === 'save') {
        this.handleSaveNote();
      }
    });
  }

  private handleSelectionChange = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      this.hideToolbar();
    }
  }

  private showSaveProgress = () => {
    const saveButton = this.shadowRoot?.getElementById('save');
    if (saveButton) {
      const originalText = saveButton.textContent;
      saveButton.textContent = 'Saving...';
      saveButton.setAttribute('disabled', 'true');
      
      setTimeout(() => {
        saveButton.textContent = originalText;
        saveButton.removeAttribute('disabled');
      }, 200);
    }
  }

  private handleSaveNote = async () => {
    this.ignoreClicksUntilMs = Date.now() + 300;
    
    if (this.currentSelection) {
      const selectedText = this.currentSelection.toString().trim();
      if (selectedText) {
        this.showSaveProgress();
        
        try {
          const bookmarkId = await bookmarksService.createAndSaveBookmark('', []); // Empty note text and tags for now
          
          if (bookmarkId) {
            console.log('[Toolbar] Bookmark saved successfully with ID:', bookmarkId);
            // Could show success feedback here
          } else {
            console.error('[Toolbar] Failed to create bookmark from selection');
          }
        } catch (error) {
          console.error('[Toolbar] Error saving bookmark:', error);
          // Could show error feedback here
        }

        setTimeout(() => {
          this.hideToolbar();
          this.ignoreClicksUntilMs = 0;
        }, 200); // Increased timeout to allow for async operation
      }
    }
  }
}