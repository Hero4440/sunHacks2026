// Nebula Content Script - Injected into every page
// Handles UI injection, page interaction, and element detection

import { ElementResolver } from './lib/element-resolver';
import { HumanInteractor } from './lib/human-interactor';
import { messageRouter } from './lib/messaging';
import {
  ExecutionAbortReason,
  type AutomationAction,
  type ExecutionSummary,
  type ExecutionStepResult,
} from '../../shared/automation';

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
  private currentActionPlan: AutomationAction[] | null = null;
  private planMetadata: { model?: string; source?: string; cached?: boolean; requestId?: string } | null = null;
  private currentPlanSummary: ExecutionSummary | null = null;
  private isExecutingPlan = false;
  private lastSearchQuery = '';
  private navigationIntent: { action: any; query: string } | null = null;

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
            <div id="nebula-plan-container" class="nebula-ai-plan nebula-hidden"></div>
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
        this.lastSearchQuery = query;
        this.detectNavigationIntent(query);
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
          } else if (this.navigationIntent) {
            void this.performNavigationIntent();
          } else {
            void this.handleFallbackIntent(query);
          }
        }
      });
    }
  }

  private async handleSearch(query: string, resultsContainer: HTMLElement): Promise<void> {
    if (query.trim().length < 2) {
      resultsContainer.innerHTML = '';
      this.navigationIntent = null;
      return;
    }

    try {
      // Send search query to background script with longer timeout
      const response = await messageRouter.sendMessage({
        type: 'SPOTLIGHT_SEARCH',
        payload: { query },
      }, undefined, 10000); // 10 second timeout for search

      if (response.success && response.data) {
        this.renderSearchResults(response.data, resultsContainer, query);
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

  private renderSearchResults(results: any[], container: HTMLElement, rawQuery?: string): void {
    const visibleResults = results.slice(0, 6);
    this.latestResults = visibleResults;
    const normalizedQuery = rawQuery ?? this.lastSearchQuery;

    if (visibleResults.length > 0 && visibleResults[0]?.fallback) {
      this.navigationIntent = { action: visibleResults[0].action, query: normalizedQuery };
    } else if (!this.navigationIntent || this.navigationIntent.query !== normalizedQuery) {
      this.detectNavigationIntent(normalizedQuery);
    }

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

    const resultsContainer = this.shadowRoot.getElementById('nebula-results');
    if (resultsContainer) {
      this.renderSearchResults(results, resultsContainer, this.lastSearchQuery);
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
    this.navigationIntent = null;
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

    const planSteps = Array.isArray(payload.plan) ? payload.plan as AutomationAction[] : null;
    this.renderActionPlan(planSteps, payload.planMetadata ?? null, null);

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

  private describeAutomationAction(action: AutomationAction): string {
    const truncate = (value: string, length = 32): string => {
      if (value.length <= length) {
        return value;
      }
      return `${value.slice(0, length - 1)}…`;
    };

    switch (action.act) {
      case 'find':
        return action.target ? `Find “${action.target}”` : 'Find element';
      case 'scroll': {
        const destination = action.to ? action.to : 'center';
        return action.target
          ? `Scroll to “${action.target}” (${destination})`
          : `Scroll to ${destination}`;
      }
      case 'focus':
        return action.target ? `Focus “${action.target}”` : 'Focus element';
      case 'type': {
        const preview = action.text ? truncate(action.text) : 'text';
        return action.target
          ? `Type “${preview}” in “${action.target}”`
          : `Type “${preview}”`;
      }
      case 'click': {
        const target = action.target ? `“${action.target}”` : 'element';
        return action.confirm ? `Confirm click on ${target}` : `Click ${target}`;
      }
      case 'tab':
        return 'Press Tab';
      case 'wait':
        return `Wait ${action.waitMs ?? 0}ms`;
      default:
        return action.act;
    }
  }

  private renderActionPlan(
    plan: AutomationAction[] | null,
    metadata: { model?: string; source?: string; cached?: boolean; requestId?: string } | null,
    summary: ExecutionSummary | null,
  ): void {
    const container = this.ensureAIContainer();
    if (!container) {
      return;
    }

    const planContainer = container.querySelector('#nebula-plan-container') as HTMLElement | null;
    if (!planContainer) {
      return;
    }

    if (!plan || plan.length === 0) {
      this.currentActionPlan = null;
      this.planMetadata = null;
      this.currentPlanSummary = null;
      this.isExecutingPlan = false;
      planContainer.classList.add('nebula-hidden');
      planContainer.innerHTML = '';
      return;
    }

    this.currentActionPlan = plan;
    this.planMetadata = metadata ?? null;
    this.currentPlanSummary = summary ?? null;

    const statusMap = new Map<number, ExecutionStepResult>();
    if (summary?.steps?.length) {
      summary.steps.forEach((step, index) => {
        statusMap.set(index, step);
      });
    }

    const stepsHtml = plan.map((step, index) => {
      const result = statusMap.get(index);
      const status = result?.status ?? (this.isExecutingPlan ? 'pending' : 'pending');
      const statusClass = status === 'success'
        ? 'nebula-plan-step-success'
        : status === 'failed'
          ? 'nebula-plan-step-failed'
          : 'nebula-plan-step-pending';
      const icon = status === 'success'
        ? '✓'
        : status === 'failed'
          ? '⚠'
          : String(index + 1);
      const message = result?.message
        ? `<div class="nebula-plan-step-message">${this.escapeHTML(result.message)}</div>`
        : '';
      return `
        <li class="nebula-plan-step ${statusClass}" data-index="${index}">
          <span class="nebula-plan-step-index">${icon}</span>
          <span class="nebula-plan-step-label">${this.escapeHTML(this.describeAutomationAction(step))}</span>
          ${message}
        </li>
      `;
    }).join('');

    const metaParts: string[] = [];
    if (metadata?.model) {
      metaParts.push(`Model: ${metadata.model}`);
    }
    if (metadata?.source) {
      metaParts.push(`Source: ${metadata.source}`);
    }
    if (metadata?.cached) {
      metaParts.push('Cached');
    }
    if (metadata?.requestId) {
      metaParts.push(`Request: ${metadata.requestId}`);
    }
    if (summary?.durationMs !== undefined) {
      metaParts.push(`Duration: ${Math.round(summary.durationMs)}ms`);
    }

    const metaHtml = metaParts.length
      ? `<div class="nebula-plan-meta">${metaParts.map(part => `<span>${this.escapeHTML(part)}</span>`).join(' • ')}</div>`
      : '';

    const abortHtml = summary?.abortReason
      ? `<div class="nebula-plan-note">Stopped: ${this.escapeHTML(summary.abortReason)}</div>`
      : '';

    const buttonDisabled = this.isExecutingPlan ? 'disabled' : '';
    const buttonLabel = this.isExecutingPlan
      ? 'Working…'
      : summary?.completed
        ? 'Run Again'
        : 'Start Assist';

    planContainer.innerHTML = `
      <div class="nebula-plan-header">
        <span class="nebula-ai-subtitle">Action Plan</span>
        <button id="nebula-start-assist" class="nebula-plan-button" ${buttonDisabled}>${buttonLabel}</button>
      </div>
      <ol id="nebula-plan-steps" class="nebula-plan-list">${stepsHtml}</ol>
      ${abortHtml}
      ${metaHtml}
    `;

    const startButton = planContainer.querySelector('#nebula-start-assist') as HTMLButtonElement | null;
    if (startButton) {
      startButton.addEventListener('click', () => {
        void this.handleStartAssist();
      });
    }

    planContainer.classList.remove('nebula-hidden');
  }

  private async handleStartAssist(): Promise<void> {
    if (this.isExecutingPlan) {
      return;
    }

    if (!this.currentActionPlan || this.currentActionPlan.length === 0) {
      this.showToast({
        title: 'No plan available',
        message: 'Ask Nebula for help before starting Assist.',
        variant: 'info',
      });
      return;
    }

    this.isExecutingPlan = true;
    this.renderActionPlan(this.currentActionPlan, this.planMetadata, this.currentPlanSummary);

    const result = await this.executeActionPlan(this.currentActionPlan);

    this.isExecutingPlan = false;
    this.renderActionPlan(this.currentActionPlan, this.planMetadata, result.summary);

    if (result.success) {
      this.showToast({
        title: 'Assist complete',
        message: 'Nebula finished the plan successfully.',
        variant: 'success',
      });
    } else {
      this.showToast({
        title: 'Assist interrupted',
        message: result.summary.abortReason ? `Stopped: ${result.summary.abortReason}` : 'Some steps could not be completed.',
        variant: 'warning',
      });
    }
  }

  private showAIError(message: string): void {
    this.aiStatus = 'error';
    const container = this.ensureAIContainer();
    if (!container) {
      return;
    }

    this.renderActionPlan(null, null, null);

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
    this.renderActionPlan(null, null, null);
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
    const plan: AutomationAction[] = actionPlan;
    const stepResults: ExecutionStepResult[] = [];
    const start = performance.now();
    let completed = true;
    let abortReason: ExecutionAbortReason | undefined;

    for (let index = 0; index < plan.length; index++) {
      const action = plan[index];
      try {
        const result = await this.humanInteractor.executeAction(action);
        if (result.success) {
          stepResults.push({ action, status: 'success', message: result.message });
        } else {
          completed = false;
          abortReason = ExecutionAbortReason.Unknown;
          stepResults.push({ action, status: 'failed', message: result.error ?? result.message });
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        completed = false;
        abortReason = ExecutionAbortReason.Unknown;
        stepResults.push({
          action,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        break;
      }
    }

    if (!completed) {
      for (let i = stepResults.length; i < plan.length; i++) {
        stepResults.push({ action: plan[i], status: 'skipped' });
      }
    }

    const summary: ExecutionSummary = {
      completed,
      abortReason,
      steps: stepResults,
      durationMs: performance.now() - start,
    };

    this.currentPlanSummary = summary;
    this.renderActionPlan(this.currentActionPlan, this.planMetadata, summary);

    chrome.runtime.sendMessage({
      type: 'PLAN_EXECUTION_RESULT',
      payload: { summary },
    }).catch(() => {});

    return { success: summary.completed, summary };
  }

  private detectNavigationIntent(rawQuery: string): void {
    const trimmed = rawQuery.trim();

    if (!trimmed) {
      this.navigationIntent = null;
      return;
    }

    const lower = trimmed.toLowerCase();

    const setIntent = (action: any) => {
      this.navigationIntent = { action, query: rawQuery };
    };

    const matches = (...patterns: Array<string | RegExp>) =>
      patterns.some(pattern =>
        typeof pattern === 'string' ? lower === pattern : pattern.test(lower),
      );

    if (matches('back', 'go back', /(go\s+)?back$/)) {
      setIntent({ kind: 'navigate', direction: 'back' });
      return;
    }

    if (matches('forward', 'go forward', /(go\s+)?forward$/)) {
      setIntent({ kind: 'navigate', direction: 'forward' });
      return;
    }

    if (matches('reload', 'refresh', 'reload page', 'refresh page', /^(reload|refresh)(\s+page)?$/)) {
      setIntent({ kind: 'navigate', direction: 'reload' });
      return;
    }

    if (matches('new tab', 'open new tab', /^(open\s+)?new\s+tab$/)) {
      setIntent({ kind: 'browser_command', command: 'new_tab' });
      return;
    }

    if (matches('close tab', 'close current tab', 'close this tab', /^(close|shut)\s+(the\s+)?tab$/)) {
      setIntent({ kind: 'browser_command', command: 'close_tab' });
      return;
    }

    if (matches('history', 'open history', 'show history')) {
      setIntent({ kind: 'open_url', url: 'chrome://history', active: true });
      return;
    }

    if (matches('downloads', 'open downloads', 'show downloads')) {
      setIntent({ kind: 'open_url', url: 'chrome://downloads', active: true });
      return;
    }

    if (matches('extensions', 'open extensions', 'show extensions')) {
      setIntent({ kind: 'open_url', url: 'chrome://extensions', active: true });
      return;
    }

    const settingsMatch = lower.match(/^(?:open|show)?\s*settings(?:\s+for|\s+about)?\s+(.+)$/);
    if (settingsMatch && settingsMatch[1]) {
      const encoded = encodeURIComponent(settingsMatch[1].trim());
      setIntent({ kind: 'open_url', url: `chrome://settings/?search=${encoded}`, active: true });
      return;
    }

    const zoomMatch = lower.match(/^zoom\s*(?:to\s*)?(\d+)%?$/);
    if (zoomMatch) {
      const value = parseInt(zoomMatch[1], 10);
      if (!Number.isNaN(value)) {
        setIntent({ kind: 'set_zoom', value });
        return;
      }
    }

    const screenshotMatch = lower.match(/^(?:take\s+)?screenshot(?:\s+(full|entire)(?:\s+page)?|\s+(visible))?$/);
    if (screenshotMatch) {
      const mode = screenshotMatch[1] ? 'full' : (screenshotMatch[2] ? 'visible' : (lower.includes('full') || lower.includes('entire') ? 'full' : 'visible'));
      setIntent({ kind: 'content_message', message: { type: 'TAKE_SCREENSHOT', payload: { mode } } });
      return;
    }

    const openCommandRegex = /^(?:open|go to|visit)\s+(.+)$/i;
    const directUrlRegex = /^https?:\/\//i;
    const domainRegex = /^([a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i;
    const simpleTokenRegex = /^[a-z0-9-]+$/i;

    const openMatch = trimmed.match(openCommandRegex);
    const candidate = openMatch ? openMatch[1].trim() : trimmed;
    const hasOpenCommand = Boolean(openMatch);

    if (!candidate) {
      this.navigationIntent = null;
      return;
    }

    const candidateNoQuotes = candidate.replace(/["'<>]/g, '').trim();

    if (!candidateNoQuotes) {
      this.navigationIntent = null;
      return;
    }

    let url: string | null = null;

    if (directUrlRegex.test(candidateNoQuotes)) {
      url = candidateNoQuotes;
    } else if (directUrlRegex.test(trimmed)) {
      url = trimmed;
    } else if (domainRegex.test(candidateNoQuotes)) {
      url = candidateNoQuotes.startsWith('http') ? candidateNoQuotes : `https://${candidateNoQuotes}`;
    } else if (hasOpenCommand && simpleTokenRegex.test(candidateNoQuotes)) {
      url = `https://www.${candidateNoQuotes}.com`;
    } else if (hasOpenCommand) {
      url = `https://www.google.com/search?q=${encodeURIComponent(candidateNoQuotes)}`;
    }

    if (url) {
      setIntent({ kind: 'open_url', url, active: true });
    } else {
      this.navigationIntent = null;
    }
  }

  private async performNavigationIntent(): Promise<void> {
    const intent = this.navigationIntent;
    if (!intent) {
      return;
    }

    this.navigationIntent = null;

    try {
      await messageRouter.sendMessage({
        type: 'EXECUTE_SPOTLIGHT_ACTION',
        payload: { action: intent.action },
      }, undefined, 15000);
      this.closeCommandPalette();
    } catch (error) {
      console.error('Error executing navigation intent:', error);
      this.showToast({
        title: 'Unable to navigate',
        message: error instanceof Error ? error.message : 'Nebula could not complete that action.',
        variant: 'error',
      });
    }
  }

  private async handleFallbackIntent(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    const expectedKinds: string[] = [];
    const lower = trimmed.toLowerCase();

    if (lower.includes('tab')) {
      expectedKinds.push('switch_tab');
    }
    if (lower.includes('history')) {
      expectedKinds.push('search_history');
    }
    if (lower.includes('download')) {
      expectedKinds.push('open_url');
    }
    if (lower.startsWith('open ') || lower.startsWith('go to') || lower.startsWith('visit ')) {
      expectedKinds.push('open_url');
    }

    const executed = await this.classifyAndExecuteIntent(trimmed, expectedKinds);
    if (!executed) {
      await this.askNebula(query);
    }
  }

  private async classifyAndExecuteIntent(query: string, expectedKinds: string[] = []): Promise<boolean> {
    try {
      const response = await messageRouter.sendMessage({
        type: 'CLASSIFY_INTENT',
        payload: { query, expectedKinds },
      }, undefined, 15000);

      if (response?.success) {
        this.closeCommandPalette();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Intent classification failed:', error);
      return false;
    }
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
