// Message Router - Handles communication between extension components
// Provides type-safe messaging with error handling and timeouts

export type Message = {
  type: string;
  id?: string;
  timestamp: number;
  payload?: any;
};

export type MessageResponse = {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    processingTime: number;
    source: string;
  };
};

export class MessageRouter {
  private readonly DEFAULT_TIMEOUT = 10000; // 10 seconds

  constructor(shouldListen = true) {
    if (shouldListen) {
      this.setupMessageListener();
    }
  }

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error) => {
          console.error('Error handling message:', error);
          sendResponse({
            success: false,
            error: error.message || 'Unknown error',
            metadata: {
              processingTime: 0,
              source: 'message-router',
            },
          });
        });

      return true; // Keep message channel open for async response
    });
  }

  public async handleMessage(
    message: Message,
    sender: chrome.runtime.MessageSender,
  ): Promise<MessageResponse> {
    const startTime = Date.now();

    try {
      // Route message based on type
      return await this.routeMessage(message, sender);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          processingTime: Date.now() - startTime,
          source: sender.tab ? 'content-script' : 'extension',
        },
      };
    }
  }

  private async routeMessage(
    message: Message,
    sender: chrome.runtime.MessageSender,
  ): Promise<MessageResponse> {
    const startTime = Date.now();

    switch (message.type) {
      case 'PING':
        return {
          success: true,
          data: 'pong',
          metadata: {
            processingTime: Date.now() - startTime,
            source: 'message-router',
          },
        };

      case 'GET_TAB_INFO':
        if (sender.tab) {
          return {
            success: true,
            data: {
              id: sender.tab.id,
              url: sender.tab.url,
              title: sender.tab.title,
              windowId: sender.tab.windowId,
            },
            metadata: {
              processingTime: Date.now() - startTime,
              source: 'background',
            },
          };
        }
        throw new Error('No tab information available');

      default:
        // Let the background script handle other message types
        return {
          success: true,
          data: null,
          metadata: {
            processingTime: Date.now() - startTime,
            source: 'message-router',
          },
        };
    }
  }

  async sendMessage(
    message: Omit<Message, 'timestamp'>,
    target?: { tabId?: number; frameId?: number },
    timeout = this.DEFAULT_TIMEOUT,
  ): Promise<MessageResponse> {
    const messageWithTimestamp: Message = {
      ...message,
      id: message.id || this.generateId(),
      timestamp: Date.now(),
    };

    return new Promise<MessageResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Message timeout after ${timeout}ms`));
      }, timeout);

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
      };

      const handleResponse = (response?: MessageResponse): void => {
        cleanup();

        if (!response) {
          resolve({ success: false, error: 'No response from receiver' });
          return;
        }

        resolve(response);
      };

      try {
        if (target?.tabId) {
          const callback = (response?: MessageResponse): void => {
            if (chrome.runtime.lastError) {
              cleanup();
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            handleResponse(response);
          };

          if (typeof target.frameId === 'number') {
            chrome.tabs.sendMessage(target.tabId, messageWithTimestamp, { frameId: target.frameId }, callback);
          } else {
            chrome.tabs.sendMessage(target.tabId, messageWithTimestamp, callback);
          }
        } else {
          chrome.runtime.sendMessage(messageWithTimestamp, (response?: MessageResponse) => {
            if (chrome.runtime.lastError) {
              cleanup();
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            handleResponse(response);
          });
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to deliver message'));
      }
    });
  }

  async sendToActiveTab(
    message: Omit<Message, 'timestamp'>,
    timeout = this.DEFAULT_TIMEOUT,
  ): Promise<MessageResponse> {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab?.id) {
      throw new Error('No active tab found');
    }

    return this.sendMessage(message, { tabId: activeTab.id }, timeout);
  }

  async sendToAllTabs(
    message: Omit<Message, 'timestamp'>,
    filter?: (tab: chrome.tabs.Tab) => boolean,
  ): Promise<MessageResponse[]> {
    const tabs = await chrome.tabs.query({});
    const filteredTabs = filter ? tabs.filter(filter) : tabs;

    const promises = filteredTabs
      .filter(tab => tab.id)
      .map(tab =>
        this.sendMessage(message, { tabId: tab.id! })
          .catch(error => ({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            metadata: { processingTime: 0, source: 'message-router' },
          })),
      );

    return Promise.all(promises);
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Utility methods for common message patterns

  async ping(target?: { tabId?: number }): Promise<boolean> {
    try {
      const response = await this.sendMessage({ type: 'PING' }, target, 1000);
      return response.success && response.data === 'pong';
    } catch {
      return false;
    }
  }

  async getTabInfo(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      const response = await this.sendMessage(
        { type: 'GET_TAB_INFO' },
        { tabId },
        2000,
      );
      return response.success ? response.data : null;
    } catch {
      return null;
    }
  }

  async isContentScriptReady(tabId: number): Promise<boolean> {
    return this.ping({ tabId });
  }
}

// Export singleton instance
export const messageRouter = new MessageRouter();
