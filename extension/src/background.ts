// Nebula AI Copilot - Background Service Worker
// Handles Spotlight search, tab management, and API communication

import type { WorkerAnswer, WorkerPlan, WorkerIntent } from './lib/api-client';
import { askWorker, planWorker } from './lib/api-client';
import { type ContextBundle, ContextBundler, type PageData } from './lib/context-bundler';
import { MessageRouter } from './lib/messaging';
import { type SpotlightAction, SpotlightEngine } from './lib/spotlight';
import { NebulaStorage } from './lib/storage';
import type { AutomationAction, ExecutionSummary } from '../../shared/automation';

type ToastVariant = 'success' | 'warning' | 'error' | 'info';

type ToastPayload = {
  id?: string;
  title?: string;
  message: string;
  variant?: ToastVariant;
  timeoutMs?: number;
  action?: {
    label: string;
    messageType: string;
    payload?: any;
  };
};

class NebulaBackground {
  private spotlight: SpotlightEngine;
  private contextBundler: ContextBundler;
  private messageRouter: MessageRouter;
  private storage: NebulaStorage;
  private paletteState = new Map<number, boolean>();
  private tabContexts = new Map<number, PageData>();
  private lastNavigation?: {
    previousTabId: number;
    previousWindowId: number;
    undoId: string;
    createdAt: number;
    createdTabId?: number;
    createdWindowId?: number;
  };

  private tabRequestLog = new Map<number, {
    request: {
      query: string;
      bundle: ContextBundle;
    };
    response?: WorkerAnswer;
    plan?: WorkerPlan;
    planExecution?: ExecutionSummary;
    latencyMs?: number;
    timestamp: number;
  }>();

  private readonly defaultSettings = {
    safeMode: false,
    proactiveChips: true,
    tokenCapPerDay: 10000,
    cacheTTL: 180,
    screenshotRedaction: true,
    spotlightSources: ['tabs', 'history', 'sessions'],
    allowedSites: [],
    deniedSites: [],
    recallEnabled: false,
  };

  constructor() {
    this.spotlight = new SpotlightEngine();
    this.storage = new NebulaStorage();
    void this.storage.init();
    this.contextBundler = new ContextBundler(this.storage);
    this.messageRouter = new MessageRouter(false); // Let NebulaBackground handle listening

    this.initializeEventListeners();
  }

  private initializeEventListeners(): void {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener(this.handleInstalled.bind(this));

    // Handle command palette hotkey
    chrome.commands.onCommand.addListener(this.handleCommand.bind(this));

    // Handle messages from content scripts and UI
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Handle tab events for Spotlight indexing
    chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Handle window events
    chrome.windows.onFocusChanged.addListener(this.handleWindowFocusChanged.bind(this));
  }

  private async handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
    console.log('Nebula AI Copilot installed:', details.reason);

    // Initialize default settings
    await chrome.storage.local.set({
      nebulaSettings: this.defaultSettings,
    });

    // Show welcome page on first install
    if (details.reason === 'install') {
      chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html'),
      });
    }
  }

  private async handleCommand(command: string): Promise<void> {
    console.log('Command received:', command);

    if (command === 'open-command-palette') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!activeTab?.id) {
        await this.openFallbackPopup();
        return;
      }

      const isOpen = this.paletteState.get(activeTab.id) ?? false;
      const nextAction = isOpen ? 'CLOSE_COMMAND_PALETTE' : 'OPEN_COMMAND_PALETTE';

      try {
        const response = await chrome.tabs.sendMessage(activeTab.id, {
          type: nextAction,
          timestamp: Date.now(),
        });

        if (response?.success) {
          const openState = response?.data?.open;
          this.paletteState.set(activeTab.id, typeof openState === 'boolean' ? openState : !isOpen);
        }
      } catch (error) {
        console.log('Could not inject into this tab (likely restricted):', error);
        this.paletteState.delete(activeTab.id);
        await this.openFallbackPopup();
      }
    }
  }

  private async handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ): Promise<boolean> {
    const { type, payload = {} } = message;
    console.log('Background received message:', type, message);

    // Let the message router handle its internal routing first (for responses)
    const routerResponse = await this.messageRouter.handleMessage(message, sender);
    if (routerResponse.data !== null) { // if router handled it, we're done
      sendResponse(routerResponse);
      return true;
    }

    try {
      switch (type) {
        case 'SPOTLIGHT_SEARCH': {
          const query = payload.query ?? message.query ?? '';

          if (!query.trim()) {
            sendResponse({ success: true, data: [] });
            break;
          }

          const activeTabId = sender.tab?.id ?? (await this.getActiveTabId());
          if (activeTabId) {
            const sitePolicy = await this.evaluateSitePolicy(activeTabId);
            if (!sitePolicy.allowed) {
              await this.sendToastToTab(activeTabId, {
                title: 'Nebula disabled',
                message: sitePolicy.reason ?? 'Nebula is turned off on this site.',
                variant: 'warning',
                timeoutMs: 6000,
              });
              sendResponse({ success: true, data: [] });
              break;
            }
          }

          // Check if query needs history/sessions permissions
          const needsHistory = query.toLowerCase().includes('history')
            || query.toLowerCase().includes('recent')
            || query.toLowerCase().includes('visited');

          const needsSessions = query.toLowerCase().includes('session')
            || query.toLowerCase().includes('reopen')
            || query.toLowerCase().includes('closed');

          if (needsHistory || needsSessions) {
            const hasPermissions = await this.checkHistoryPermissions();
            if (!hasPermissions) {
              await this.sendToastToTab(sender.tab?.id ?? (await this.getActiveTabId()) ?? -1, {
                title: 'History Access Needed',
                message: 'Grant history permission to search your recent sites and sessions.',
                variant: 'warning',
                action: {
                  label: 'Grant Permission',
                  messageType: 'REQUEST_HISTORY_PERMISSION',
                  payload: { originalQuery: query },
                },
              });
              sendResponse({ success: true, data: [] });
              break;
            }
          }

          const spotlightResults = await this.spotlight.search(query);
          sendResponse({ success: true, data: spotlightResults });
          break;
        }

        case 'BUNDLE_CONTEXT': {
          const pageData = payload.pageData ?? message.pageData;
          const context = await this.contextBundler.bundle(pageData);
          sendResponse({ success: true, data: context });
          break;
        }

        case 'PAGE_DATA_EXTRACTED': {
          if (payload?.page) {
            await this.contextBundler.updateTimeline(payload.page, payload.tldr);
          } else if (payload?.title && payload?.url) {
            await this.contextBundler.updateTimeline(payload, payload.tldr);
          }
          if (payload?.topicTags?.length) {
            await this.contextBundler.updateTopicTags(payload.url, payload.topicTags);
          }
          if (sender.tab) {
            await this.spotlight.updateTabIndex(sender.tab);
            if (sender.tab.id && payload?.topicTags?.length) {
              this.spotlight.setTabTopicTags(sender.tab.id, payload.topicTags);
            }
            if (sender.tab.id && payload) {
              const page = payload.page || payload;
              if (page?.title && page?.url) {
                this.tabContexts.set(sender.tab.id, page as PageData);
              }
            }
          }
          sendResponse({ success: true });
          break;
        }

        case 'PALETTE_STATE_CHANGED': {
          if (sender.tab?.id) {
            this.paletteState.set(sender.tab.id, !!payload.open);
          }
          sendResponse({ success: true });
          break;
        }

        case 'ASK_NEBULA': {
          const tabId = sender.tab?.id;
          if (!tabId) {
            throw new Error('ASK_NEBULA requires an active tab');
          }

          const query = payload.query ?? '';
          if (!query.trim()) {
            throw new Error('Empty query sent to ASK_NEBULA');
          }

          const sitePolicy = await this.evaluateSitePolicy(tabId);
          if (!sitePolicy.allowed) {
            await this.sendToastToTab(tabId, {
              title: 'Nebula disabled',
              message: sitePolicy.reason ?? 'This site is blocked in your settings.',
              variant: 'warning',
              timeoutMs: 6000,
            });
            sendResponse({ success: false, error: sitePolicy.reason ?? 'Site blocked' });
            break;
          }

          let pageData = this.tabContexts.get(tabId);
          if (!pageData) {
            try {
              const extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_DATA' });
              if (extract?.success && extract.data) {
                pageData = extract.data as PageData;
                this.tabContexts.set(tabId, pageData);
              }
            } catch (error) {
              console.warn('Unable to retrieve page data from tab', error);
            }
          }

          if (!pageData) {
            throw new Error('No page context available for this tab yet');
          }

          const bundle = await this.contextBundler.bundle(pageData);

          if (bundle.tokenCount > this.contextBundler.getTokenLimit() * 0.9) {
            await this.sendToastToTab(tabId, {
              title: 'Large context',
              message: `Using ${bundle.tokenCount} of ${this.contextBundler.getTokenLimit()} tokens. Consider narrowing the selection.`,
              variant: 'warning',
              timeoutMs: 6000,
            });
          }

          this.tabRequestLog.set(tabId, {
            request: {
              query,
              bundle,
            },
            timestamp: Date.now(),
          });
          await this.notifyPayloadUpdate(tabId);

          const askPromise = askWorker(query, bundle);
          const planPromise = planWorker(query, bundle).catch(error => {
            console.warn('Failed to generate action plan', error);
            return null;
          });

          let workerResponse: WorkerAnswer;
          const start = performance.now();
          try {
            workerResponse = await askPromise;
          } catch (error) {
            await chrome.tabs.sendMessage(tabId, {
              type: 'AI_RESPONSE',
              payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown AI error',
              },
            });
            throw error;
          }

          const planResponse = await planPromise;

          const latencyMs = workerResponse.latencyMs ?? Math.round(performance.now() - start);

          await chrome.tabs.sendMessage(tabId, {
            type: 'AI_RESPONSE',
            payload: {
              success: true,
              query,
              answer: workerResponse.answer,
              steps: workerResponse.steps,
              citations: workerResponse.citations,
              model: workerResponse.model,
              cached: workerResponse.cached,
              latencyMs,
              plan: planResponse?.steps ?? null,
              planMetadata: planResponse ? {
                model: planResponse.model,
                source: planResponse.source,
                cached: planResponse.cached,
                requestId: planResponse.requestId,
              } : null,
            },
          });

          chrome.runtime.sendMessage({
            type: 'UPDATE_ANSWERS',
            payload: {
              answer: workerResponse.answer,
              query,
              model: workerResponse.model,
              latencyMs,
              cached: workerResponse.cached,
            },
          }).catch(() => {});

          if (planResponse?.steps?.length) {
            chrome.runtime.sendMessage({
              type: 'UPDATE_STEPS',
              payload: this.describePlanForSidebar(planResponse.steps),
            }).catch(() => {});
          } else {
            chrome.runtime.sendMessage({
              type: 'UPDATE_STEPS',
              payload: [],
            }).catch(() => {});
          }

          const reqEntry = this.tabRequestLog.get(tabId);
          if (reqEntry) {
            reqEntry.response = workerResponse;
            reqEntry.latencyMs = latencyMs;
            reqEntry.timestamp = Date.now();
            reqEntry.plan = planResponse ?? undefined;
            this.tabRequestLog.set(tabId, reqEntry);
            await this.notifyPayloadUpdate(tabId);
          }

          if (workerResponse.source === 'stub') {
            await this.sendToastToTab(tabId, {
              title: 'Working offline',
              message: 'Using fallback answers until the AI service is reachable again.',
              variant: 'warning',
              timeoutMs: 6000,
            });
          } else if (workerResponse.cached) {
            await this.sendToastToTab(tabId, {
              message: 'Served a cached answer to keep things fast.',
              variant: 'info',
              timeoutMs: 4000,
            });
          }

          sendResponse({ success: true });
          break;
        }

        case 'SWITCH_TAB': {
          const tabId = payload.tabId ?? message.tabId;
          const windowId = payload.windowId ?? message.windowId;
          await this.handleSwitchTab(tabId, windowId);
          sendResponse({ success: true });
          break;
        }

        case 'REOPEN_TAB': {
          const query = payload.query ?? message.query ?? '';
          const reopenedTab = await this.handleReopenTab(query);
          sendResponse({ success: true, data: reopenedTab });
          break;
        }

        case 'CAPTURE_SCREENSHOT': {
          const mode = payload.mode ?? 'visible';
          const tabId = payload.tabId;
          const result = await this.captureScreenshot(mode, tabId);
          sendResponse(result);
          break;
        }

        case 'EXECUTE_SPOTLIGHT_ACTION': {
          if (!payload.action) {
            throw new Error('No action provided for Spotlight execution');
          }
          const action: SpotlightAction = payload.action;
          const activeTabId = sender.tab?.id ?? (await this.getActiveTabId());

          if (activeTabId) {
            const policy = await this.evaluateAutomationPolicy(activeTabId, action);
            if (!policy.allowed) {
              await this.sendToastToTab(activeTabId, {
                title: 'Safe mode enabled',
                message: policy.reason ?? 'Automation is disabled by your settings.',
                variant: 'info',
                timeoutMs: 6000,
              });
              sendResponse({ success: false, error: policy.reason ?? 'Automation blocked' });
              break;
            }
          }

          switch (action.kind) {
            case 'activate_tab':
              await this.handleSwitchTab(action.tabId, action.windowId);
              break;
            case 'open_url':
              await this.handleOpenUrl(action.url, action.active ?? true);
              break;
            case 'restore_session':
              await this.handleRestoreSession(action.sessionId);
              break;
            default:
              await this.spotlight.executeAction(action);
          }
          sendResponse({ success: true });
          break;
        }

        case 'UNDO_NAVIGATION': {
          const undoId = payload.undoId;

          if (!undoId || !this.lastNavigation || this.lastNavigation.undoId !== undoId) {
            sendResponse({ success: false, error: 'Nothing to undo' });
            break;
          }

          if (Date.now() - this.lastNavigation.createdAt > 15000) {
            this.lastNavigation = undefined;
            sendResponse({ success: false, error: 'Undo option expired' });
            break;
          }

          const { previousTabId, previousWindowId, createdTabId, createdWindowId } = this.lastNavigation;
          this.lastNavigation = undefined;

          try {
            if (createdTabId) {
              await chrome.tabs.remove(createdTabId).catch(() => {});
            }
            if (createdWindowId && createdWindowId !== previousWindowId) {
              await chrome.windows.remove(createdWindowId).catch(() => {});
            }
            await chrome.tabs.update(previousTabId, { active: true });
            await chrome.windows.update(previousWindowId, { focused: true }).catch(() => {});
            await this.sendToastToTab(previousTabId, {
              title: 'Returned',
              message: 'You are back on your previous tab.',
              variant: 'success',
              timeoutMs: 4000,
            });
            sendResponse({ success: true });
          } catch (error) {
            console.warn('Undo navigation failed', error);
            sendResponse({ success: false, error: 'Unable to restore previous tab' });
          }

          break;
        }

        case 'GET_SETTINGS': {
          const settings = await this.getSettings();
          sendResponse({ success: true, data: settings });
          break;
        }

        case 'UPDATE_SETTINGS': {
          const settings = payload.settings ?? payload;
          await this.updateSettings(settings);

          if (settings.recallEnabled) {
            await this.ensureHistoryPermission();
          }

          sendResponse({ success: true });
          break;
        }

        case 'FORGET_ALL_DATA': {
          await this.resetAllData();
          sendResponse({ success: true });
          break;
        }

        case 'ENABLE_RECALL': {
          const granted = await this.ensureHistoryPermission();
          if (granted) {
            await this.updateSettings({ recallEnabled: true });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Permission denied' });
          }
          break;
        }

        case 'REQUEST_HISTORY_PERMISSION': {
          const granted = await this.requestHistoryPermission();
          if (granted) {
            const tabId = sender.tab?.id ?? (await this.getActiveTabId()) ?? -1;
            await this.sendToastToTab(tabId, {
              title: 'Permission Granted',
              message: 'You can now search your browsing history.',
              variant: 'success',
              timeoutMs: 4000,
            });

            // Re-execute the original search if we have the query
            const originalQuery = payload.originalQuery;
            if (originalQuery && sender.tab?.id) {
              try {
                const spotlightResults = await this.spotlight.search(originalQuery);

                // Send results back to content script
                await chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'SPOTLIGHT_RESULTS_UPDATED',
                  payload: { query: originalQuery, results: spotlightResults },
                });
              } catch (error) {
                console.error('Error re-executing search after permission grant:', error);
              }
            }

            sendResponse({ success: true });
          } else {
            const tabId = sender.tab?.id ?? (await this.getActiveTabId()) ?? -1;
            await this.sendToastToTab(tabId, {
              title: 'Permission Required',
              message: 'History access is needed for this search. You can grant it later in settings.',
              variant: 'info',
              timeoutMs: 6000,
            });
            sendResponse({ success: false, error: 'Permission denied' });
          }
          break;
        }

        case 'CLASSIFY_INTENT': {
          const query = (payload.query ?? message.query ?? '').trim();
          if (!query) {
            sendResponse({ success: false, error: 'Empty query' });
            break;
          }

          try {
            const tabId = sender.tab?.id ?? (await this.getActiveTabId());
            let pageData = tabId ? this.tabContexts.get(tabId) : null;

            if (tabId && !pageData) {
              try {
                const extract = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_DATA' });
                if (extract?.success && extract.data) {
                  pageData = extract.data as PageData;
                  this.tabContexts.set(tabId, pageData);
                }
              } catch {
                // ignore
              }
            }

            const fallbackPage: PageData = {
              title: sender.tab?.title ?? 'Untitled',
              url: sender.tab?.url ?? '',
              headings: [],
              selection: undefined,
              metadata: undefined,
            };

            const bundle = await this.contextBundler.bundle(pageData ?? fallbackPage)
              .catch(() => ({
                title: fallbackPage.title,
                url: fallbackPage.url,
                headings: [],
                selection: fallbackPage.selection,
                timeline: [],
                topicTags: [],
                timestamp: Date.now(),
                tokenCount: 0,
                baseTokens: 0,
              } as ContextBundle));

            const workerResponse = await askWorker(query, bundle, {
              mode: 'intent',
              expectedKinds: payload.expectedKinds,
            });

            const intent = workerResponse.intent;
            if (intent && intent.kind && intent.kind !== 'unknown') {
              const executed = await this.executeIntentAction(intent, tabId ?? undefined);
              sendResponse({ success: executed, data: { intent } });
            } else {
              sendResponse({ success: false, data: { intent } });
            }
          } catch (error) {
            console.error('Intent classification failed:', error);
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Intent classification failed' });
          }

          break;
        }

        case 'PLAN_EXECUTION_RESULT': {
          const execution: ExecutionSummary | undefined = message.payload?.summary;
          const executionTabId = sender.tab?.id ?? (await this.getActiveTabId());

          if (executionTabId && execution) {
            const entry = this.tabRequestLog.get(executionTabId);
            if (entry) {
              entry.planExecution = execution;
              this.tabRequestLog.set(executionTabId, entry);
              chrome.runtime.sendMessage({
                type: 'UPDATE_STEPS',
                payload: this.describePlanForSidebar(entry.plan?.steps ?? [], execution),
              }).catch(() => {});
              await this.notifyPayloadUpdate(executionTabId);
            }
          }

          sendResponse({ success: true });
          break;
        }

        case 'PING': {
          // For synchronous responses, call sendResponse and return false to indicate sync response.
          sendResponse({ success: true, data: 'pong' });
          return false; // Return false for synchronous response
        }

        default:
          console.warn('Unknown message type:', type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return true; // Keep message channel open for async response
  }

  private async captureScreenshot(mode: string, tabId?: number): Promise<any> {
    try {
      const targetTabId = tabId ?? (await this.getActiveTabId());
      if (targetTabId === null) {
        return { success: false, error: 'No active tab to capture' };
      }

      const windowId = (await chrome.tabs.get(targetTabId)).windowId;
      const format = mode === 'full' ? 'png' : 'jpeg';
      const quality = mode === 'full' ? undefined : 80;

      const image = await chrome.tabs.captureVisibleTab(windowId, {
        format,
        quality,
      });

      return { success: true, data: { image, format, mode } };
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture screenshot',
      };
    }
  }

  private async checkHistoryPermissions(): Promise<boolean> {
    try {
      return await chrome.permissions.contains({ permissions: ['history', 'sessions'] });
    } catch (error) {
      console.error('Error checking history permissions', error);
      return false;
    }
  }

  private async requestHistoryPermission(): Promise<boolean> {
    try {
      const granted = await chrome.permissions.request({ permissions: ['history', 'sessions'] });
      if (!granted) {
        console.info('User declined history permissions');
      }
      return granted;
    } catch (error) {
      console.error('Error requesting history permissions', error);
      return false;
    }
  }

  private async ensureHistoryPermission(): Promise<boolean> {
    try {
      const hasHistory = await this.checkHistoryPermissions();
      if (hasHistory) {
        return true;
      }

      return await this.requestHistoryPermission();
    } catch (error) {
      console.error('Error ensuring history permissions', error);
      return false;
    }
  }

  private async getTabHost(tabId: number): Promise<string | null> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url) {
        return null;
      }
      const url = new URL(tab.url);
      return url.hostname.replace(/^www\./, '');
    } catch (error) {
      console.error('Error determining tab host', error);
      return null;
    }
  }

  private async evaluateSitePolicy(tabId: number): Promise<{ allowed: boolean; reason?: string; host?: string }> {
    if (!tabId || tabId < 0) {
      return { allowed: false, reason: 'Unknown tab.' };
    }

    const settings = await this.getSettings();
    const host = await this.getTabHost(tabId);
    if (!host) {
      return { allowed: false, reason: 'Nebula cannot run on this page.' };
    }

    if (settings.deniedSites?.includes(host)) {
      return { allowed: false, reason: `Nebula is blocked on ${host}.`, host };
    }

    if (settings.allowedSites && settings.allowedSites.length > 0 && !settings.allowedSites.includes(host)) {
      return { allowed: false, reason: `${host} is not in your allowed sites list.`, host };
    }

    return { allowed: true, host };
  }

  private async evaluateAutomationPolicy(tabId: number, action: SpotlightAction): Promise<{ allowed: boolean; reason?: string }> {
    const sitePolicy = await this.evaluateSitePolicy(tabId);
    if (!sitePolicy.allowed) {
      return sitePolicy;
    }

    const settings = await this.getSettings();
    if (settings.safeMode && this.actionRequiresAutomation(action)) {
      return { allowed: false, reason: 'Safe Mode is on. Turn it off to control this site.' };
    }

    return { allowed: true };
  }

  private actionRequiresAutomation(action: SpotlightAction): boolean {
    switch (action.kind) {
      case 'activate_tab':
        return false;
      case 'open_url':
      case 'restore_session':
      case 'browser_command':
      case 'set_zoom':
      case 'navigate':
        return false;
      case 'content_message': {
        const safeMessages = new Set(['TAKE_SCREENSHOT', 'EXTRACT_PAGE_DATA', 'PING']);
        return !safeMessages.has(action.message.type);
      }
      default:
        return true;
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
        const textPreview = action.text ? truncate(action.text) : 'text';
        return action.target
          ? `Type “${textPreview}” in “${action.target}”`
          : `Type “${textPreview}”`;
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

  private describePlanForSidebar(
    steps: AutomationAction[],
    execution?: ExecutionSummary | null,
  ): Array<{ index: number; label: string; status: 'pending' | 'success' | 'failed'; message?: string }> {
    if (!steps || steps.length === 0) {
      return [];
    }

    const statusMap = new Map<number, { status: 'pending' | 'success' | 'failed'; message?: string }>();

    if (execution?.steps?.length) {
      execution.steps.forEach((stepResult, index) => {
        let status: 'pending' | 'success' | 'failed' = 'pending';
        if (stepResult.status === 'success') {
          status = 'success';
        } else if (stepResult.status === 'failed') {
          status = 'failed';
        }
        statusMap.set(index, { status, message: stepResult.message });
      });
    }

    return steps.map((step, index) => {
      const result = statusMap.get(index);
      return {
        index,
        label: this.describeAutomationAction(step),
        status: result?.status ?? 'pending',
        message: result?.message,
      };
    });
  }

  private async sendToastToTab(tabId: number, toast: ToastPayload): Promise<void> {
    if (!tabId || tabId < 0) {
      return;
    }
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_TOAST',
        payload: toast,
      });
    } catch (error) {
      console.debug('Unable to deliver toast to tab', tabId, error);
    }
  }

  private async notifyPayloadUpdate(tabId: number): Promise<void> {
    const entry = this.tabRequestLog.get(tabId);
    if (!entry) {
      return;
    }

    const payload = {
      tabId,
      timestamp: entry.timestamp,
      request: entry.request,
      response: entry.response,
      latencyMs: entry.latencyMs,
      plan: entry.plan,
      planExecution: entry.planExecution,
    };

    chrome.runtime.sendMessage({
      type: 'WORKER_PAYLOAD',
      payload,
    }).catch(() => {});

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'PAYLOAD_UPDATED',
        payload,
      });
    } catch (error) {
      // Tab may not have listener; ignore
    }
  }

  private async promptUndoNavigation(currentTabId: number, undoId: string): Promise<void> {
    await this.sendToastToTab(currentTabId, {
      id: `undo-${undoId}`,
      title: 'Switched tabs',
      message: 'Back to where you were?',
      variant: 'info',
      timeoutMs: 8000,
      action: {
        label: 'Undo',
        messageType: 'UNDO_NAVIGATION',
        payload: { undoId },
      },
    });
  }

  private generateUndoId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
  }

  private scheduleUndoExpiry(undoId: string): void {
    setTimeout(() => {
      if (this.lastNavigation && this.lastNavigation.undoId === undoId) {
        this.lastNavigation = undefined;
      }
    }, 15000);
  }

  private async getActiveTabId(): Promise<number | null> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id ?? null;
  }

  private async resetAllData(): Promise<void> {
    await chrome.storage.local.remove(['nebulaTimeline', 'nebulaTopicTags']);
    await this.storage.forgetAll();
    this.tabRequestLog.clear();
  }

  private async handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
    // Update Spotlight index when tab becomes active
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await this.spotlight.updateTabIndex(tab);
    } catch (error) {
      console.error('Error updating tab index:', error);
    }
  }

  private async handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ): Promise<void> {
    // Update index when tab title or URL changes
    if (changeInfo.title || changeInfo.url) {
      await this.spotlight.updateTabIndex(tab);
    }
  }

  private async handleTabRemoved(tabId: number): Promise<void> {
    // Remove from Spotlight index
    await this.spotlight.removeTabFromIndex(tabId);
    this.paletteState.delete(tabId);
    this.tabContexts.delete(tabId);
    this.tabRequestLog.delete(tabId);
    if (this.lastNavigation && this.lastNavigation.previousTabId === tabId) {
      this.lastNavigation = undefined;
    }
  }

  private async handleWindowFocusChanged(windowId: number): Promise<void> {
    // Update window focus for tab prioritization
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      await this.spotlight.updateWindowFocus(windowId);
    }
  }

  private async openFallbackPopup(): Promise<void> {
    try {
      await chrome.action.openPopup();
    } catch (error) {
      console.warn('Unable to open action popup:', error);
    }
  }

  private async handleSwitchTab(tabId: number, windowId?: number): Promise<void> {
    let previousTab: chrome.tabs.Tab | undefined;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      previousTab = tabs[0];
    } catch (error) {
      console.warn('Unable to determine previous tab', error);
    }

    // Switch to specified tab and raise window if needed
    await chrome.tabs.update(tabId, { active: true });

    if (windowId) {
      await chrome.windows.update(windowId, { focused: true });
    }

    if (previousTab?.id && previousTab.id !== tabId && previousTab.windowId !== undefined) {
      const undoId = this.generateUndoId();
      this.lastNavigation = {
        previousTabId: previousTab.id,
        previousWindowId: previousTab.windowId,
        undoId,
        createdAt: Date.now(),
      };

      await this.promptUndoNavigation(tabId, undoId);
      this.scheduleUndoExpiry(undoId);
    }
  }

  private async handleOpenUrl(url: string, active: boolean): Promise<chrome.tabs.Tab | null> {
    let previousTab: chrome.tabs.Tab | undefined;

    if (active) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        previousTab = tabs[0];
      } catch (error) {
        console.warn('Unable to determine previous tab before opening URL', error);
      }
    }

    const newTab = await chrome.tabs.create({ url, active });

    if (newTab?.id) {
      await this.spotlight.updateTabIndex(newTab);
    }

    if (active && previousTab?.id && previousTab.windowId !== undefined && newTab?.id && previousTab.id !== newTab.id) {
      const undoId = this.generateUndoId();
      this.lastNavigation = {
        previousTabId: previousTab.id,
        previousWindowId: previousTab.windowId,
        undoId,
        createdAt: Date.now(),
        createdTabId: newTab.id,
        createdWindowId: newTab.windowId,
      };

      await this.promptUndoNavigation(newTab.id, undoId);
      this.scheduleUndoExpiry(undoId);
    }

    return newTab ?? null;
  }

  private async handleRestoreSession(sessionId: string): Promise<chrome.tabs.Tab | null> {
    let previousTab: chrome.tabs.Tab | undefined;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      previousTab = tabs[0];
    } catch (error) {
      console.warn('Unable to determine previous tab before restoring session', error);
    }

    const restored = await chrome.sessions.restore(sessionId);
    let restoredTab = restored?.tab ?? restored?.window?.tabs?.[0] ?? null;
    if (restoredTab?.id === undefined && restored?.tab?.id !== undefined) {
      restoredTab = restored.tab;
    }
    const targetTabId = restoredTab?.id ?? null;
    const targetWindowId = restoredTab?.windowId ?? restored?.window?.id;

    if (targetTabId) {
      await chrome.tabs.update(targetTabId, { active: true });
      try {
        const tabDetails = await chrome.tabs.get(targetTabId);
        await this.spotlight.updateTabIndex(tabDetails);
        restoredTab = tabDetails;
      } catch (error) {
        console.warn('Unable to update restored tab index', error);
      }
    }

    if (targetWindowId !== undefined) {
      await chrome.windows.update(targetWindowId, { focused: true }).catch(() => {});
    }

    if (previousTab?.id && targetTabId && previousTab.id !== targetTabId && previousTab.windowId !== undefined) {
      const undoId = this.generateUndoId();
      this.lastNavigation = {
        previousTabId: previousTab.id,
        previousWindowId: previousTab.windowId,
        undoId,
        createdAt: Date.now(),
        createdTabId: targetTabId,
        createdWindowId: targetWindowId,
      };

      await this.promptUndoNavigation(targetTabId, undoId);
      this.scheduleUndoExpiry(undoId);
    }

    return restoredTab ?? null;
  }

  private async handleReopenTab(query: string): Promise<chrome.tabs.Tab | null> {
    // Try to reopen from recently closed sessions first
    try {
      const recentlyClosed = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });

      for (const session of recentlyClosed) {
        if (session.tab && this.matchesQuery(session.tab.title || session.tab.url || '', query)) {
          return await this.handleRestoreSession(session.tab.sessionId!);
        }
      }
    } catch (error) {
      console.error('Error accessing sessions:', error);
    }

    // Fallback to history search
    try {
      const historyItems = await chrome.history.search({
        text: query,
        maxResults: 5,
        startTime: Date.now() - (14 * 24 * 60 * 60 * 1000), // Last 14 days
      });

      if (historyItems.length > 0) {
        return await this.handleOpenUrl(historyItems[0].url ?? '', true);
      }
    } catch (error) {
      console.error('Error searching history:', error);
    }

    return null;
  }

  private async executeIntentAction(intent: WorkerIntent, senderTabId?: number): Promise<boolean> {
    if (!intent || typeof intent.kind !== 'string') {
      return false;
    }

    const kind = intent.kind.toLowerCase();
    const payload = intent.payload ?? {};

    switch (kind) {
      case 'open_url': {
        const url = typeof payload?.url === 'string' ? payload.url : '';
        if (!url) {
          return false;
        }
        const active = payload?.active === false ? false : true;
        await this.handleOpenUrl(url, active);
        return true;
      }

      case 'navigate': {
        const direction = typeof payload?.direction === 'string' ? payload.direction : 'reload';
        await this.spotlight.executeAction({
          kind: 'navigate',
          direction: direction as 'back' | 'forward' | 'reload',
        });
        return true;
      }

      case 'browser_command': {
        const command = typeof payload?.command === 'string' ? payload.command : '';
        if (!command) {
          return false;
        }
        await this.spotlight.executeAction({
          kind: 'browser_command',
          command: command as 'new_tab' | 'close_tab' | 'reload',
        });
        return true;
      }

      case 'set_zoom': {
        const value = Number(payload?.value);
        if (!Number.isFinite(value) || value <= 0) {
          return false;
        }
        await this.spotlight.executeAction({
          kind: 'set_zoom',
          value,
        });
        return true;
      }

      case 'screenshot': {
        const mode = typeof payload?.mode === 'string' && payload.mode.includes('full') ? 'full' : 'visible';
        await this.spotlight.executeAction({
          kind: 'content_message',
          message: { type: 'TAKE_SCREENSHOT', payload: { mode } },
        });
        return true;
      }

      case 'search_history': {
        const query = typeof payload?.query === 'string' && payload.query.trim().length > 0
          ? payload.query.trim()
          : '';
        const url = query
          ? `chrome://history/?q=${encodeURIComponent(query)}`
          : 'chrome://history';
        await this.handleOpenUrl(url, true);
        return true;
      }

      case 'switch_tab': {
        const tabQuery = typeof payload?.tabQuery === 'string' && payload.tabQuery.trim().length > 0
          ? payload.tabQuery.trim()
          : (typeof intent.tabQuery === 'string' ? intent.tabQuery.trim() : '');

        if (!tabQuery) {
          return false;
        }

        const switched = await this.executeSwitchTabIntent(tabQuery);
        if (!switched) {
          await this.sendToastToTab(senderTabId ?? -1, {
            title: 'Tab not found',
            message: `Couldn't find a tab matching “${tabQuery}”.`,
            variant: 'info',
            timeoutMs: 4000,
          });
        }
        return switched;
      }

      default:
        return false;
    }
  }

  private async executeSwitchTabIntent(tabQuery: string): Promise<boolean> {
    const query = tabQuery.trim();
    if (!query) {
      return false;
    }

    try {
      const results = await this.spotlight.search(query);
      const tabResult = results.find(result => result.type === 'tab' && result.action.kind === 'activate_tab');

      if (tabResult && tabResult.action.kind === 'activate_tab') {
        await this.handleSwitchTab(tabResult.action.tabId, tabResult.action.windowId);
        return true;
      }
    } catch (error) {
      console.error('Failed to execute switch_tab intent', error);
    }

    return false;
  }

  private matchesQuery(text: string, query: string): boolean {
    return text.toLowerCase().includes(query.toLowerCase());
  }

  private async getSettings(): Promise<any> {
    const result = await chrome.storage.local.get('nebulaSettings');
    if (!result.nebulaSettings) {
      await chrome.storage.local.set({ nebulaSettings: this.defaultSettings });
      return this.defaultSettings;
    }

    return { ...this.defaultSettings, ...result.nebulaSettings };
  }

  private async updateSettings(newSettings: any): Promise<void> {
    const currentSettings = await this.getSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    await chrome.storage.local.set({ nebulaSettings: updatedSettings });
    chrome.runtime.sendMessage({
      type: 'SETTINGS_CHANGED',
      payload: updatedSettings,
      timestamp: Date.now(),
    }).catch(() => {
      // Ignore errors if no listeners are available
    });
  }

}

// Initialize the background service
console.log('Nebula AI Copilot background service starting...');

try {
  const nebulaBackground = new NebulaBackground();
  console.log('Nebula AI Copilot background service initialized successfully');

  // Ensure we're responsive immediately
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Emergency message handler:', message.type);
    if (message.type === 'PING') {
      sendResponse({ success: true, data: 'pong', source: 'emergency' });
      return false;
    }
  });
} catch (error) {
  console.error('Failed to initialize Nebula background service:', error);
}
