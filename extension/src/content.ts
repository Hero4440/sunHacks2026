// Nebula Content Script - Injected into every page
// Handles UI injection, page interaction, and element detection

import { ElementResolver } from './lib/element-resolver';
import { HumanInteractor } from './lib/human-interactor';
import { messageRouter } from './lib/messaging';

type ToastActionPayload = {
  label: string;
  messageType: string;
  payload?: any;
};

type ToastPayload = {
  id?: string;
  title?: string;
  message: string;
  variant?: 'success' | 'warning' | 'error' | 'info';
  timeoutMs?: number;
  action?: ToastActionPayload;
};

class NebulaContentScript {
  private shadowRoot: ShadowRoot | null = null;
  private isInjected = false;
  private isCommandPaletteOpen = false;
  private elementResolver: ElementResolver;
  private humanInteractor: HumanInteractor;
  private currentPageData: any = null;
  private latestResults: any[] = [];
  private aiContainer: HTMLElement | null = null;
  private aiStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private lastAIQuery = '';
  private toastContainer: HTMLElement | null = null;

  constructor() {
    this.elementResolver = new ElementResolver();
    this.humanInteractor = new HumanInteractor();

    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (!this.isExtensionContextValid()) {
      console.warn('Nebula: Extension context missing during initialization; aborting setup.');
      return;
    }

    // Skip injection on chrome:// pages and other restricted origins
    if (this.isRestrictedPage()) {
      console.log('Nebula: Skipping injection on restricted page');
      return;
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupContentScript());
    } else {
      this.setupContentScript();
    }

    // Set up message listeners
    this.setupMessageListeners();
  }

  private isRestrictedPage(): boolean {
    const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'edge:'];
    const restrictedHosts = ['accounts.google.com', 'login.microsoftonline.com'];

    return (
      restrictedProtocols.some(protocol => window.location.href.startsWith(protocol))
      || restrictedHosts.includes(window.location.hostname)
    );
  }

  private async setupContentScript(): Promise<void> {
    try {
      // Detect CSP restrictions
      const canInjectOverlay = await this.detectCSPRestrictions();

      if (canInjectOverlay) {
        await this.injectShadowDOM();
      } else {
        console.log('Nebula: CSP restrictions detected, sidebar-only mode');
        // Fallback to sidebar-only mode
        await this.injectSidebar();
      }

      // Extract initial page data
      this.currentPageData = this.extractPageData();

      // Send page data to background script for context bundling
      this.sendPageDataToBackground();

      console.log('Nebula content script initialized');
    } catch (error) {
      console.error('Error setting up Nebula content script:', error);
    }
  }

  private async waitForBackgroundReady(retries = 8): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        // Try to wake up the service worker first
        if (i > 0) {
          console.log(`Nebula: Attempting to wake service worker (attempt ${i + 1}/${retries})`);
          // Send a direct chrome.runtime message to wake up the service worker
          try {
            await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(response);
                }
              });
            });
          } catch (directError) {
            console.log('Direct wake attempt failed:', directError);
          }
        }

        const response = await messageRouter.sendMessage({ type: 'PING' }, undefined, 3000);
        if (response?.success && response?.data === 'pong') {
          console.log('Nebula: Background script is ready.');
          return true;
        }
      } catch (error) {
        console.log(`Nebula: Ping attempt ${i + 1} failed:`, error);
        // Exponential backoff
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.min(500 * Math.pow(2, i), 3000)));
        }
      }
    }
    console.warn('Nebula: Background script did not respond to ping; continuing anyway.');
    return false;
  }

  private isExtensionContextValid(): boolean {
    try {
      return typeof chrome !== 'undefined'
        && !!chrome.runtime
        && typeof chrome.runtime.id === 'string'
        && chrome.runtime.id.length > 0;
    } catch (error) {
      console.warn('Nebula: Failed to verify extension context', error);
      return false;
    }
  }

  private async detectCSPRestrictions(): Promise<boolean> {
    try {
      // Try to create a simple element with inline styles
      const testDiv = document.createElement('div');
      testDiv.style.cssText = 'position: absolute; visibility: hidden;';
      document.body.appendChild(testDiv);
      document.body.removeChild(testDiv);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async injectShadowDOM(): Promise<void> {
    if (this.isInjected) {
      return;
    }

    if (!this.isExtensionContextValid()) {
      console.warn('Nebula: Extension context unavailable during shadow DOM injection; skipping.');
      return;
    }

    // Create shadow host
    const shadowHost = document.createElement('div');
    shadowHost.id = 'nebula-extension-root';
    shadowHost.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      width: 100vw !important;
      height: 100vh !important;
    `;

    // Create shadow root
    this.shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    // Load CSS and create UI container
    const style = document.createElement('style');
    style.textContent = await this.loadExtensionCSS();
    this.shadowRoot.appendChild(style);

    // Create UI container
    const uiContainer = document.createElement('div');
    uiContainer.id = 'nebula-ui-container';
    uiContainer.className = 'nebula-fixed nebula-inset-0 nebula-pointer-events-none nebula-z-50';
    this.shadowRoot.appendChild(uiContainer);

    const toastContainer = document.createElement('div');
    toastContainer.id = 'nebula-toast-container';
    toastContainer.className = 'nebula-toast-container';
    uiContainer.appendChild(toastContainer);
    this.toastContainer = toastContainer;

    // Inject into page
    document.documentElement.appendChild(shadowHost);

    // Load React sidebar component
    await this.loadSidebarComponent();

    this.isInjected = true;
  }

  private async injectSidebar(): Promise<void> {
    // Sidebar-only fallback for CSP-restricted pages
    if (!this.isExtensionContextValid()) {
      console.warn('Nebula: Extension context unavailable; cannot inject sidebar.');
      return;
    }

    const sidebar = document.createElement('iframe');
    sidebar.id = 'nebula-sidebar';
    sidebar.src = chrome.runtime.getURL('sidebar/index.html');
    sidebar.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      right: -400px !important;
      width: 400px !important;
      height: 100vh !important;
      border: none !important;
      z-index: 2147483647 !important;
      background: white !important;
      box-shadow: -2px 0 10px rgba(0,0,0,0.1) !important;
      transition: right 0.3s ease !important;
    `;

    document.documentElement.appendChild(sidebar);
    this.isInjected = true;
  }

  private async loadExtensionCSS(): Promise<string> {
    try {
      if (!this.isExtensionContextValid()) {
        console.warn('Nebula: Skipping CSS load because extension context is unavailable.');
        return '';
      }

      const response = await fetch(chrome.runtime.getURL('content.css'));
      return await response.text();
    } catch (error) {
      console.error('Error loading extension CSS:', error);
      return '';
    }
  }

  private async loadSidebarComponent(): Promise<void> {
    if (!this.shadowRoot) {
      return;
    }

    // This would normally load the React component
    // For now, create a simple command palette interface
    const commandPalette = document.createElement('div');
    commandPalette.id = 'nebula-command-palette';
    commandPalette.className = 'nebula-hidden';
    commandPalette.innerHTML = `
      <div class="nebula-fixed nebula-inset-0 nebula-bg-black nebula-bg-opacity-50 nebula-flex nebula-items-start nebula-justify-center nebula-pt-16 nebula-pointer-events-auto">
        <div class="nebula-bg-white nebula-rounded-lg nebula-shadow-xl nebula-w-full nebula-max-w-lg nebula-p-4">
          <input
            type="text"
            id="nebula-search-input"
            placeholder="Ask Nebula anything..."
            class="nebula-w-full nebula-px-3 nebula-py-2 nebula-border nebula-rounded-md nebula-text-sm"
          />
          <div id="nebula-ai-container" class="nebula-ai-container nebula-hidden">
            <div class="nebula-ai-header">
              <span>Nebula Answer</span>
              <span id="nebula-ai-meta" class="nebula-ai-meta"></span>
            </div>
            <div id="nebula-ai-body" class="nebula-ai-body">
              <p class="nebula-ai-placeholder">Type a question and press ⌘⏎ / Ctrl+Enter for an AI answer.</p>
            </div>
          </div>
          <div id="nebula-results" class="nebula-mt-2 nebula-space-y-1"></div>
        </div>
      </div>
    `;

    this.shadowRoot.appendChild(commandPalette);

    // Set up command palette event listeners
    this.setupCommandPaletteEvents();
  }

  private setupCommandPaletteEvents(): void {
    if (!this.shadowRoot) {
      return;
    }

    const input = this.shadowRoot.getElementById('nebula-search-input') as HTMLInputElement;
    const results = this.shadowRoot.getElementById('nebula-results');
    this.aiContainer = this.shadowRoot.getElementById('nebula-ai-container') as HTMLElement | null;

    if (input && results) {
      input.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value;
        this.handleSearch(query, results);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeCommandPalette();
        } else if (e.key === 'Enter') {
          const query = (e.target as HTMLInputElement).value;

          if (e.metaKey || e.ctrlKey) {
            void this.askNebula(query);
            return;
          }

          if (this.latestResults.length > 0) {
            this.executeSearchResult(this.latestResults[0]);
          } else {
            void this.askNebula(query);
          }
        }
      });
    }
  }

  private async handleSearch(query: string, resultsContainer: HTMLElement): Promise<void> {
    if (query.trim().length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }

    try {
      // Send search query to background script with longer timeout
      const response = await messageRouter.sendMessage({
        type: 'SPOTLIGHT_SEARCH',
        payload: { query },
      }, undefined, 10000); // 10 second timeout for search

      if (response.success && response.data) {
        this.renderSearchResults(response.data, resultsContainer);
      }
    } catch (error) {
      console.error('Error performing search:', error);

      // If timeout, try to wake the service worker and retry once
      if (error instanceof Error && error.message.includes('timeout')) {
        console.log('Search timeout - attempting to wake service worker and retry...');

        try {
          // Ping to wake the service worker
          await chrome.runtime.sendMessage({ type: 'PING', timestamp: Date.now() });

          // Retry the search
          const retryResponse = await messageRouter.sendMessage({
            type: 'SPOTLIGHT_SEARCH',
            payload: { query },
          }, undefined, 10000);

          if (retryResponse.success && retryResponse.data) {
            this.renderSearchResults(retryResponse.data, resultsContainer);
          }
        } catch (retryError) {
          console.error('Search retry also failed:', retryError);
          resultsContainer.innerHTML = '<div class="nebula-p-2 nebula-text-gray-500 nebula-text-sm">Search temporarily unavailable</div>';
        }
      } else {
        resultsContainer.innerHTML = '<div class="nebula-p-2 nebula-text-gray-500 nebula-text-sm">Search error occurred</div>';
      }
    }
  }

  private async askNebula(query: string): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }

    this.showAILoading(trimmed);

    try {
      // Try sending message with longer timeout for AI requests
      await messageRouter.sendMessage({
        type: 'ASK_NEBULA',
        payload: { query: trimmed },
      }, undefined, 15000); // 15 second timeout for AI requests
    } catch (error) {
      console.error('Error asking Nebula:', error);

      // If timeout, try to wake the service worker and retry once
      if (error instanceof Error && error.message.includes('timeout')) {
        console.log('Service worker may be idle, attempting to wake and retry...');

        try {
          // Ping to wake the service worker
          await chrome.runtime.sendMessage({ type: 'PING', timestamp: Date.now() });

          // Retry the AI request
          await messageRouter.sendMessage({
            type: 'ASK_NEBULA',
            payload: { query: trimmed },
          }, undefined, 15000);

          return; // Success on retry
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
        }
      }

      const message = error instanceof Error ? error.message : 'Unknown error contacting Nebula';
      this.showAIError(message);
    }
  }

  private renderSearchResults(results: any[], container: HTMLElement): void {
    const visibleResults = results.slice(0, 6);
    this.latestResults = visibleResults;

    container.innerHTML = visibleResults
      .map((result, index) => `
        <div class="nebula-p-2 nebula-rounded nebula-cursor-pointer nebula-hover:bg-gray-100"
             data-index="${index}">
          <div class="nebula-font-medium nebula-text-sm">${result.title}</div>
          <div class="nebula-text-xs nebula-text-gray-600 nebula-flex nebula-gap-2">
            ${result.badge ? `<span class="nebula-result-badge">${result.badge}</span>` : ''}
            <span>${result.description || ''}</span>
          </div>
        </div>
      `).join('');

    // Add click listeners
    container.querySelectorAll('[data-index]').forEach((item, index) => {
      item.addEventListener('click', () => {
        this.executeSearchResult(visibleResults[index]);
      });
    });
  }

  private updateSearchResults(results: any[]): void {
    if (!this.shadowRoot || !this.isCommandPaletteOpen) {
      return;
    }

    const resultsContainer = this.shadowRoot.getElementById('nebula-search-results');
    if (resultsContainer) {
      this.renderSearchResults(results, resultsContainer);
    }
  }

  private async executeSearchResult(result: any): Promise<void> {
    try {
          await messageRouter.sendMessage({
            type: 'EXECUTE_SPOTLIGHT_ACTION',
            payload: { action: result.action },
          }, undefined, 15000);
          this.closeCommandPalette();
        } catch (error) {
      console.error('Error executing search result:', error);
      this.showToast({
        title: 'Action unavailable',
        message: error instanceof Error ? error.message : 'Spotlight could not complete that action.',
        variant: 'error',
      });
    }
  }

  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(response => sendResponse(response))
        .catch((error) => {
          console.error('Error handling message in content script:', error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep message channel open
    });
  }

  private async handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
    switch (message.type) {
      case 'PING':
        return { success: true, data: 'pong' };

      case 'OPEN_COMMAND_PALETTE':
        this.openCommandPalette();
        return { success: true, data: { open: true } };

      case 'CLOSE_COMMAND_PALETTE':
        this.closeCommandPalette();
        return { success: true, data: { open: false } };

      case 'TOGGLE_COMMAND_PALETTE':
        if (this.isCommandPaletteOpen) {
          this.closeCommandPalette();
        } else {
          this.openCommandPalette();
        }
        return { success: true, data: { open: this.isCommandPaletteOpen } };

      case 'EXECUTE_ACTION_PLAN':
        return await this.executeActionPlan(message.payload);

      case 'TAKE_SCREENSHOT':
        return await this.takeScreenshot(message.mode);

      case 'EXTRACT_PAGE_DATA':
        return { success: true, data: this.extractPageData() };

      case 'AI_RESPONSE':
        if (message.payload?.success) {
          this.showAIResponse(message.payload);
        } else {
          this.showAIError(message.payload?.error || 'Nebula could not answer right now.');
        }
        return { success: true };

      case 'SHOW_TOAST':
        if (message.payload) {
          this.showToast(message.payload as ToastPayload);
        }
        return { success: true };

      case 'SPOTLIGHT_RESULTS_UPDATED':
        if (message.payload?.results && this.isCommandPaletteOpen) {
          this.updateSearchResults(message.payload.results);
        }
        return { success: true };

      default:
        return { success: false, error: 'Unknown message type' };
    }
  }

  private openCommandPalette(): void {
    if (!this.shadowRoot || this.isCommandPaletteOpen) {
      return;
    }

    const palette = this.shadowRoot.getElementById('nebula-command-palette');
    if (palette) {
      palette.classList.remove('nebula-hidden');
      this.isCommandPaletteOpen = true;

      // Focus the input
      const input = this.shadowRoot.getElementById('nebula-search-input') as HTMLInputElement;
      if (input) {
        setTimeout(() => input.focus(), 100);
      }

      void messageRouter.sendMessage({
        type: 'PALETTE_STATE_CHANGED',
        payload: { open: true },
      }).catch(() => {});

      this.clearAIResponse();
    }
  }

  private closeCommandPalette(): void {
    if (!this.shadowRoot || !this.isCommandPaletteOpen) {
      return;
    }

    const palette = this.shadowRoot.getElementById('nebula-command-palette');
    if (palette) {
      palette.classList.add('nebula-hidden');
      this.isCommandPaletteOpen = false;
      this.latestResults = [];

      const input = this.shadowRoot.getElementById('nebula-search-input') as HTMLInputElement | null;
      if (input) {
        input.value = '';
      }

      const results = this.shadowRoot.getElementById('nebula-results');
      if (results) {
        results.innerHTML = '';
      }

      void messageRouter.sendMessage({
        type: 'PALETTE_STATE_CHANGED',
        payload: { open: false },
      }).catch(() => {});

      this.clearAIResponse();
    }
  }

  private extractPageData(): any {
    const title = document.title;
    const url = window.location.href;

    // Extract headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .slice(0, 5)
      .map(el => ({
        text: el.textContent?.trim() || '',
        level: Number.parseInt(el.tagName.charAt(1)),
      }))
      .filter(h => h.text.length > 0);

    // Get selected text
    const selection = window.getSelection()?.toString().trim();

    // Basic metadata
    const metadata: Record<string, string> = {};
    document.querySelectorAll('meta[name], meta[property]').forEach((meta) => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (name && content) {
        metadata[name] = content;
      }
    });

    return {
      title,
      url,
      headings,
      selection: selection && selection.length > 0 ? selection : undefined,
      metadata,
    };
  }

  private async sendPageDataToBackground(): Promise<void> {
    try {
      // Ensure the background script is ready before sending the main payload.
      // This prevents a race condition on initial page load.
      const ready = await this.waitForBackgroundReady();
      if (!ready) {
        // Avoid spamming console errors if background is still waking up.
        return;
      }

          const topicTags = this.deriveTopicTags(this.currentPageData);
      await messageRouter.sendMessage({
        type: 'PAGE_DATA_EXTRACTED',
        payload: {
          ...this.currentPageData,
          topicTags,
        },
      });
    } catch (error) {
      console.error('Error sending page data to background:', error);
    }
  }

  private deriveTopicTags(pageData: any): string[] {
    if (!pageData) {
      return [];
    }

    const tags = new Set<string>();

    const addCandidate = (value?: string) => {
      if (!value) {
        return;
      }
      value
        .split(/[,#/\n]/)
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 2 && chunk.length < 40)
        .forEach((chunk) => {
          const normalized = chunk.replace(/[^a-z0-9\s-]/gi, '').trim();
          if (normalized) {
            const capitalized = normalized
              .split(/\s+/)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
            tags.add(capitalized);
          }
        });
    };

    addCandidate(pageData.metadata?.keywords);
    addCandidate(pageData.metadata?.keyword);
    addCandidate(pageData.metadata?.['og:title']);
    addCandidate(pageData.metadata?.['og:description']);

    pageData.headings?.slice(0, 3).forEach((heading: any) => addCandidate(heading.text));

    return Array.from(tags).slice(0, 5);
  }

  private showAILoading(query: string): void {
    this.aiStatus = 'loading';
    this.lastAIQuery = query;
    const container = this.ensureAIContainer();
    if (!container) {
      return;
    }

    container.classList.remove('nebula-hidden');
    const meta = container.querySelector('#nebula-ai-meta');
    if (meta) {
      meta.textContent = 'Thinking…';
    }
    const body = container.querySelector('#nebula-ai-body');
    if (body) {
      body.innerHTML = `
        <div class="nebula-ai-loading">
          <span class="nebula-spinner"></span>
          <span>Working on “${this.escapeHTML(query)}”</span>
        </div>
      `;
    }
  }

  private showAIResponse(payload: any): void {
    this.aiStatus = 'ready';
    const container = this.ensureAIContainer();
    if (!container) {
      return;
    }

    container.classList.remove('nebula-hidden');
    const meta = container.querySelector('#nebula-ai-meta');
    if (meta) {
      const parts = [] as string[];
      if (payload.model) {
        parts.push(payload.model);
      }
      if (typeof payload.latencyMs === 'number') {
        parts.push(`${payload.latencyMs}ms`);
      }
      if (payload.cached) {
        parts.push('cached');
      }
      meta.textContent = parts.join(' • ');
    }

    const answer = (payload.answer || '').trim();
    const body = container.querySelector('#nebula-ai-body');
    if (body) {
      if (!answer) {
        body.innerHTML = '<p class="nebula-ai-placeholder">No answer returned.</p>';
      } else {
        const formatted = answer
          .replace(/\n\n/g, '</p><p>')
          .replace(/\n/g, '<br />');

        body.innerHTML = `<p>${formatted}</p>`;

        if (Array.isArray(payload.citations) && payload.citations.length > 0) {
          const links = payload.citations
            .map((item: any) => `<li><a href="${this.escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${this.escapeHTML(item.title || item.url)}</a></li>`)
            .join('');
          body.innerHTML += `
            <div class="nebula-ai-citations">
              <div class="nebula-ai-subtitle">Citations</div>
              <ul>${links}</ul>
            </div>
          `;
        }
      }
    }
  }

  private showAIError(message: string): void {
    this.aiStatus = 'error';
    const container = this.ensureAIContainer();
    if (!container) {
      return;
    }

    container.classList.remove('nebula-hidden');
    const meta = container.querySelector('#nebula-ai-meta');
    if (meta) {
      meta.textContent = '';
    }
    const body = container.querySelector('#nebula-ai-body');
    if (body) {
      body.innerHTML = `<div class="nebula-ai-error">${this.escapeHTML(message)}</div>`;
    }
  }

  private clearAIResponse(): void {
    this.aiStatus = 'idle';
    const container = this.aiContainer;
    if (!container) {
      return;
    }

    container.classList.add('nebula-hidden');
    const meta = container.querySelector('#nebula-ai-meta');
    if (meta) {
      meta.textContent = '';
    }
    const body = container.querySelector('#nebula-ai-body');
    if (body) {
      body.innerHTML = '<p class="nebula-ai-placeholder">Type a question and press ⌘⏎ / Ctrl+Enter for an AI answer.</p>';
    }
  }

  private ensureAIContainer(): HTMLElement | null {
    if (!this.aiContainer && this.shadowRoot) {
      this.aiContainer = this.shadowRoot.getElementById('nebula-ai-container') as HTMLElement | null;
    }
    return this.aiContainer;
  }

  private ensureToastContainer(): HTMLElement | null {
    if (!this.toastContainer && this.shadowRoot) {
      this.toastContainer = this.shadowRoot.getElementById('nebula-toast-container') as HTMLElement | null;
    }
    return this.toastContainer;
  }

  private showToast(toast: ToastPayload): void {
    const container = this.ensureToastContainer();
    if (!container) {
      return;
    }

    const variant = toast.variant ?? 'info';
    const card = document.createElement('div');
    card.className = 'nebula-toast-card';
    card.dataset.variant = variant;
    if (toast.id) {
      card.dataset.id = toast.id;
    }

    const header = document.createElement('div');
    header.className = 'nebula-toast-header';

    if (toast.title) {
      const title = document.createElement('div');
      title.className = 'nebula-toast-title';
      title.textContent = toast.title;
      header.appendChild(title);
    }

    const closeButton = document.createElement('button');
    closeButton.className = 'nebula-toast-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Dismiss notification');
    closeButton.textContent = '×';
    header.appendChild(closeButton);

    const body = document.createElement('div');
    body.className = 'nebula-toast-body';
    body.innerHTML = this.escapeHTML(toast.message).replace(/\n/g, '<br />');

    const actions = document.createElement('div');
    actions.className = 'nebula-toast-actions';

    let dismissTimer: number | undefined;
    const removeToast = () => {
      if (dismissTimer) {
        window.clearTimeout(dismissTimer);
      }
      card.remove();
    };

    closeButton.addEventListener('click', () => removeToast());

    if (toast.action) {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.textContent = toast.action.label || 'Action';
      actionButton.addEventListener('click', () => {
        removeToast();
        messageRouter.sendMessage({
          type: toast.action!.messageType,
          payload: toast.action!.payload,
        }).catch((error) => {
          console.error('Failed to execute toast action', error);
        });
      });
      actions.appendChild(actionButton);
    }

    const timeout = toast.timeoutMs ?? (toast.action ? 8000 : 5000);
    if (timeout > 0) {
      dismissTimer = window.setTimeout(() => removeToast(), timeout);
    }

    card.appendChild(header);
    card.appendChild(body);
    if (actions.children.length > 0) {
      card.appendChild(actions);
    }

    container.appendChild(card);
  }

  private escapeHTML(text: string): string {
    return text.replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;',
    })[char] as string);
  }

  private escapeAttribute(text: string): string {
    return this.escapeHTML(text);
  }

  private async executeActionPlan(actionPlan: any[]): Promise<any> {
    const results = [];

    for (const action of actionPlan) {
      try {
        const result = await this.humanInteractor.executeAction(action);
        results.push({ action, result, success: true });

        // Wait a bit between actions
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ action, error: message, success: false });
        break; // Stop on first failure
      }
    }

    return { success: true, data: results };
  }

  private async takeScreenshot(mode: string): Promise<any> {
    try {
      // This would be handled by the background script with chrome.tabs.captureVisibleTab
      const response = await messageRouter.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        payload: { mode, tabId: 'current' },
      });

      if (!response.success) {
        this.showToast({
          title: 'Screenshot unavailable',
          message: response.error || 'Chrome blocked the capture for this tab.',
          variant: 'error',
        });
      }

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.showToast({
        title: 'Screenshot failed',
        message,
        variant: 'error',
      });
      return { success: false, error: message };
    }
  }
}

// Initialize content script
const nebulaContent = new NebulaContentScript();

console.log('Nebula content script loaded');
