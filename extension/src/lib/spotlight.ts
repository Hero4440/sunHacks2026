// Spotlight Engine - Universal Navigator for tabs, history, and settings
// Provides fast search across all browser data sources with structured actions

export type SpotlightAction =
  | { kind: 'activate_tab'; tabId: number; windowId: number }
  | { kind: 'open_url'; url: string; active?: boolean }
  | { kind: 'restore_session'; sessionId: string }
  | { kind: 'browser_command'; command: 'new_tab' | 'close_tab' | 'reload' }
  | { kind: 'content_message'; message: { type: string; payload?: any } }
  | { kind: 'set_zoom'; value: number }
  | { kind: 'navigate'; direction: 'back' | 'forward' | 'reload' }

export interface SpotlightResult {
  id: string
  type: 'tab' | 'history' | 'session' | 'settings' | 'command'
  title: string
  url?: string
  description?: string
  score: number
  icon?: string
  badge?: string
  action: SpotlightAction
}

export interface TabInfo {
  id: number
  title: string
  url: string
  favicon?: string
  windowId: number
  lastActive: number
  visitCount: number
  topicTags: string[]
}

export class SpotlightEngine {
  private tabIndex: Map<number, TabInfo> = new Map()
  private historyCache: chrome.history.HistoryItem[] = []
  private lastHistoryUpdate = 0
  private readonly HISTORY_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  constructor() {
    this.initializeTabIndex()
  }

  async search(query: string): Promise<SpotlightResult[]> {
    const normalizedQuery = query.toLowerCase().trim()

    if (!normalizedQuery) {
      return []
    }

    const results: SpotlightResult[] = []
    const intent = this.parseIntent(normalizedQuery)

    if (intent) {
      switch (intent.kind) {
        case 'switch_tab':
          results.push(...await this.searchTabs(intent.query))
          break
        case 'reopen_tab':
          results.push(...await this.searchSessions(intent.query))
          results.push(...await this.searchHistory(intent.query))
          break
        case 'history':
          results.push(...await this.searchHistory(intent.query))
          break
        case 'recent_closed':
          results.push(...await this.searchSessions(''))
          break
        case 'open_settings':
          results.push(...this.searchSettings(intent.query))
          break
        case 'screenshot':
          results.push(this.createScreenshotCommand(intent.mode))
          break
        case 'zoom':
          results.push(this.createZoomCommand(intent.value))
          break
        case 'nav':
          results.push(this.createNavCommand(intent.action))
          break
      }
    } else {
      results.push(...await this.searchTabs(normalizedQuery))
      results.push(...await this.searchHistory(normalizedQuery))
      results.push(...await this.searchSessions(normalizedQuery))
      results.push(...this.searchSettings(normalizedQuery))
      results.push(...this.searchCommands(normalizedQuery))
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }

  async executeAction(action: SpotlightAction): Promise<void> {
    switch (action.kind) {
      case 'activate_tab':
        await chrome.tabs.update(action.tabId, { active: true })
        await chrome.windows.update(action.windowId, { focused: true })
        break
      case 'open_url':
        await chrome.tabs.create({ url: action.url, active: action.active ?? true })
        break
      case 'restore_session':
        await chrome.sessions.restore(action.sessionId)
        break
      case 'browser_command': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        switch (action.command) {
          case 'new_tab':
            await chrome.tabs.create({})
            break
          case 'close_tab':
            if (activeTab?.id) {
              await chrome.tabs.remove(activeTab.id)
            }
            break
          case 'reload':
            if (activeTab?.id) {
              await chrome.tabs.reload(activeTab.id)
            }
            break
        }
        break
      }
      case 'content_message': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (activeTab?.id) {
          await chrome.tabs.sendMessage(activeTab.id, {
            type: action.message.type,
            ...action.message.payload
          })
        }
        break
      }
      case 'set_zoom': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (activeTab?.id) {
          await chrome.tabs.setZoom(activeTab.id, action.value / 100)
        }
        break
      }
      case 'navigate': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (activeTab?.id) {
          switch (action.direction) {
            case 'back':
              await chrome.tabs.goBack(activeTab.id)
              break
            case 'forward':
              await chrome.tabs.goForward(activeTab.id)
              break
            case 'reload':
              await chrome.tabs.reload(activeTab.id)
              break
          }
        }
        break
      }
    }
  }

  private parseIntent(query: string): any {
    const patterns = [
      {
        pattern: /^(?:take me to|switch to|go to)\s+(.+)$/i,
        kind: 'switch_tab',
        extract: (match: RegExpMatchArray) => ({ kind: 'switch_tab', query: match[1] })
      },
      {
        pattern: /^(?:reopen|open again)\s+(.+)$/i,
        kind: 'reopen_tab',
        extract: (match: RegExpMatchArray) => ({ kind: 'reopen_tab', query: match[1] })
      },
      {
        pattern: /^(?:search history for|find in history)\s+(.+)$/i,
        kind: 'history',
        extract: (match: RegExpMatchArray) => ({ kind: 'history', query: match[1] })
      },
      {
        pattern: /^(?:open|show)\s+history$/i,
        kind: 'history',
        extract: () => ({ kind: 'history', query: '' })
      },
      {
        pattern: /^(?:reopen|restore)\s+(?:last|previous)\s+tab$/i,
        kind: 'recent_closed',
        extract: () => ({ kind: 'recent_closed' })
      },
      {
        pattern: /^(?:open settings|settings)\s*(?:for|about)?\s*(.*)$/i,
        kind: 'open_settings',
        extract: (match: RegExpMatchArray) => ({ kind: 'open_settings', query: match[1] || '' })
      },
      {
        pattern: /^(?:open|jump to)\s+(.+?)(?:\s+tab)?$/i,
        kind: 'switch_tab',
        extract: (match: RegExpMatchArray) => ({ kind: 'switch_tab', query: match[1] })
      },
      {
        pattern: /^screenshot\s*(full\s*page|visible)?$/i,
        kind: 'screenshot',
        extract: (match: RegExpMatchArray) => ({
          kind: 'screenshot',
          mode: match[1]?.includes('full') ? 'full' : 'visible'
        })
      },
      {
        pattern: /^zoom\s*(?:to\s*)?(\d+)%?$/i,
        kind: 'zoom',
        extract: (match: RegExpMatchArray) => ({ kind: 'zoom', value: parseInt(match[1]) })
      },
      {
        pattern: /^(back|forward|reload)$/i,
        kind: 'nav',
        extract: (match: RegExpMatchArray) => ({ kind: 'nav', action: match[1].toLowerCase() })
      }
    ]

    for (const { pattern, extract } of patterns) {
      const match = query.match(pattern)
      if (match) {
        return extract(match)
      }
    }

    return null
  }

  private async searchTabs(query: string): Promise<SpotlightResult[]> {
    const results: SpotlightResult[] = []

    for (const [tabId, tabInfo] of this.tabIndex) {
      const score = this.scoreTab(tabInfo, query)

      if (score > 0.3) {
        results.push({
          id: `tab-${tabId}`,
          type: 'tab',
          title: tabInfo.title,
          url: tabInfo.url,
          description: `Active tab in window ${tabInfo.windowId}`,
          score: score + 0.5,
          icon: tabInfo.favicon,
          badge: 'Tab',
          action: {
            kind: 'activate_tab',
            tabId,
            windowId: tabInfo.windowId
          }
        })
      }
    }

    return results
  }

  private async searchHistory(query: string): Promise<SpotlightResult[]> {
    await this.updateHistoryCache()
    const results: SpotlightResult[] = []
    const trimmed = query.trim()

    let position = 0
    for (const item of this.historyCache) {
      if (!item.url) continue

      const baseScore = trimmed
        ? this.scoreHistoryItem(item, trimmed)
        : Math.max(0.5 - position * 0.05, 0.25)

      if (baseScore > 0.2) {
        results.push({
          id: `history-${item.id}`,
          type: 'history',
          title: item.title || 'Untitled',
          url: item.url,
          description: `Visited ${this.formatDate(item.lastVisitTime)}`,
          score: baseScore,
          badge: 'History',
          action: {
            kind: 'open_url',
            url: item.url,
            active: true
          }
        })
      }

      position += 1
    }

    return results
  }

  private async searchSessions(query: string): Promise<SpotlightResult[]> {
    const results: SpotlightResult[] = []
    const trimmed = query.trim()

    try {
      const recentlyClosed = await chrome.sessions.getRecentlyClosed({ maxResults: 10 })

      let position = 0
      for (const session of recentlyClosed) {
        if (session.tab) {
          const score = trimmed
            ? this.scoreTab({
              id: -1,
              title: session.tab.title || '',
              url: session.tab.url || '',
              windowId: -1,
              lastActive: 0,
              visitCount: 0,
              topicTags: []
            }, trimmed)
            : Math.max(0.4 - position * 0.05, 0.2)

          if (score > 0.2) {
            results.push({
              id: `session-${session.tab.sessionId}`,
              type: 'session',
              title: session.tab.title || 'Untitled',
              url: session.tab.url,
              description: 'Recently closed tab',
              score: score + 0.2,
              badge: 'Recently closed',
              action: {
                kind: 'restore_session',
                sessionId: session.tab.sessionId!
              }
            })
          }
          position += 1
        }
      }
    } catch (error) {
      console.error('Error searching sessions:', error)
    }

    return results
  }

  private searchSettings(query: string): SpotlightResult[] {
    const settingsMap = [
      {
        key: 'cookies',
        title: 'Cookie Settings',
        url: 'chrome://settings/cookies',
        description: 'Manage cookies and site data',
        keywords: ['cookies', 'site data', 'tracking', 'privacy']
      },
      {
        key: 'privacy',
        title: 'Privacy and Security',
        url: 'chrome://settings/privacy',
        description: 'Privacy and security settings',
        keywords: ['privacy', 'security', 'safe browsing', 'permissions']
      },
      {
        key: 'passwords',
        title: 'Password Manager',
        url: 'chrome://settings/passwords',
        description: 'Manage saved passwords',
        keywords: ['passwords', 'autofill', 'credentials', 'login']
      },
      {
        key: 'notifications',
        title: 'Notification Settings',
        url: 'chrome://settings/content/notifications',
        description: 'Manage website notifications',
        keywords: ['notifications', 'alerts', 'push', 'permissions']
      },
      {
        key: 'extensions',
        title: 'Extensions',
        url: 'chrome://extensions',
        description: 'Manage Chrome extensions',
        keywords: ['extensions', 'addons', 'plugins', 'apps']
      }
    ]

    const results: SpotlightResult[] = []

    for (const setting of settingsMap) {
      const score = this.scoreText(
        [setting.title, setting.description, ...setting.keywords].join(' '),
        query
      )

      if (score > 0.1) {
        results.push({
          id: `settings-${setting.key}`,
          type: 'settings',
          title: setting.title,
          description: setting.description,
          score,
          badge: 'Settings',
          action: {
            kind: 'open_url',
            url: setting.url,
            active: true
          }
        })
      }
    }

    return results
  }

  private searchCommands(query: string): SpotlightResult[] {
    const commands: Array<{
      key: string
      title: string
      description: string
      keywords: string[]
      action: SpotlightAction
    }> = [
      {
        key: 'new-tab',
        title: 'New Tab',
        description: 'Open a new tab',
        keywords: ['new', 'tab', 'open'],
        action: {
          kind: 'browser_command',
          command: 'new_tab'
        }
      },
      {
        key: 'close-tab',
        title: 'Close Current Tab',
        description: 'Close the active tab',
        keywords: ['close', 'tab', 'exit'],
        action: {
          kind: 'browser_command',
          command: 'close_tab'
        }
      },
      {
        key: 'reload',
        title: 'Reload Page',
        description: 'Refresh the current page',
        keywords: ['reload', 'refresh', 'update'],
        action: {
          kind: 'browser_command',
          command: 'reload'
        }
      }
    ]

    const results: SpotlightResult[] = []

    for (const command of commands) {
      const score = this.scoreText(
        [command.title, command.description, ...command.keywords].join(' '),
        query
      )

      if (score > 0.1) {
        results.push({
          id: `command-${command.key}`,
          type: 'command',
          title: command.title,
          description: command.description,
          score,
          badge: 'Command',
          action: command.action
        })
      }
    }

    return results
  }

  private createScreenshotCommand(mode: string): SpotlightResult {
    return {
      id: `command-screenshot-${mode}`,
      type: 'command',
      title: `Screenshot (${mode})`,
      description: `Capture ${mode} screenshot of current page`,
      score: 1.0,
      badge: 'Action',
      action: {
        kind: 'content_message',
        message: {
          type: 'TAKE_SCREENSHOT',
          payload: { mode }
        }
      }
    }
  }

  private createZoomCommand(value: number): SpotlightResult {
    return {
      id: `command-zoom-${value}`,
      type: 'command',
      title: `Zoom to ${value}%`,
      description: `Set page zoom level to ${value}%`,
      score: 1.0,
      badge: 'Action',
      action: {
        kind: 'set_zoom',
        value
      }
    }
  }

  private createNavCommand(action: string): SpotlightResult {
    const actions = {
      back: { title: 'Go Back', description: 'Navigate to previous page' },
      forward: { title: 'Go Forward', description: 'Navigate to next page' },
      reload: { title: 'Reload Page', description: 'Refresh current page' }
    } as const

    const actionInfo = actions[action as keyof typeof actions]

    return {
      id: `command-nav-${action}`,
      type: 'command',
      title: actionInfo.title,
      description: actionInfo.description,
      score: 1.0,
      badge: 'Action',
      action: {
        kind: 'navigate',
        direction: action as 'back' | 'forward' | 'reload'
      }
    }
  }

  private scoreTab(tab: TabInfo, query: string): number {
    let score = 0

    score += this.scoreText(tab.title, query) * 0.7
    score += this.scoreText(tab.url, query) * 0.3

    for (const tag of tab.topicTags) {
      score += this.scoreText(tag, query) * 0.5
    }

    const ageHours = (Date.now() - tab.lastActive) / (1000 * 60 * 60)
    score += Math.max(0, 0.2 - (ageHours / 100))

    score += Math.min(0.1, tab.visitCount / 100)

    return Math.min(1.0, score)
  }

  private scoreHistoryItem(item: chrome.history.HistoryItem, query: string): number {
    let score = 0

    score += this.scoreText(item.title || '', query) * 0.6
    score += this.scoreText(item.url || '', query) * 0.4

    const ageHours = (Date.now() - (item.lastVisitTime || 0)) / (1000 * 60 * 60)
    score += Math.max(0, 0.1 - (ageHours / 1000))

    score += Math.min(0.1, (item.visitCount || 0) / 50)

    return Math.min(1.0, score)
  }

  private scoreText(text: string, query: string): number {
    const normalizedText = text.toLowerCase()
    const normalizedQuery = query.toLowerCase()

    if (normalizedText.includes(normalizedQuery)) {
      if (normalizedText === normalizedQuery) return 1.0
      if (normalizedText.startsWith(normalizedQuery)) return 0.9
      if (normalizedText.includes(' ' + normalizedQuery)) return 0.7
      return 0.5
    }

    let queryIndex = 0
    for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
      if (normalizedText[i] === normalizedQuery[queryIndex]) {
        queryIndex++
      }
    }

    return queryIndex === normalizedQuery.length ? 0.3 : 0
  }

  private async updateHistoryCache(): Promise<void> {
    const now = Date.now()

    if (now - this.lastHistoryUpdate < this.HISTORY_CACHE_TTL) {
      return
    }

    try {
      this.historyCache = await chrome.history.search({
        text: '',
        maxResults: 100,
        startTime: now - (14 * 24 * 60 * 60 * 1000)
      })
      this.lastHistoryUpdate = now
    } catch (error) {
      console.error('Error updating history cache:', error)
    }
  }

  private async initializeTabIndex(): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({})

      for (const tab of tabs) {
        if (tab.id) {
          this.tabIndex.set(tab.id, {
            id: tab.id,
            title: tab.title || '',
            url: tab.url || '',
            favicon: tab.favIconUrl,
            windowId: tab.windowId,
            lastActive: tab.active ? Date.now() : 0,
            visitCount: 0,
            topicTags: []
          })
        }
      }

      console.log('Spotlight tab index initialized with', this.tabIndex.size, 'tabs')
    } catch (error) {
      console.error('Error initializing tab index:', error)
    }
  }

  async updateTabIndex(tab: chrome.tabs.Tab): Promise<void> {
    if (!tab.id) return

    const existing = this.tabIndex.get(tab.id)

    this.tabIndex.set(tab.id, {
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      favicon: tab.favIconUrl,
      windowId: tab.windowId,
      lastActive: tab.active ? Date.now() : (existing?.lastActive || 0),
      visitCount: existing?.visitCount || 0,
      topicTags: existing?.topicTags || []
    })
  }

  async removeTabFromIndex(tabId: number): Promise<void> {
    this.tabIndex.delete(tabId)
  }

  async updateWindowFocus(windowId: number): Promise<void> {
    for (const [, tabInfo] of this.tabIndex) {
      if (tabInfo.windowId === windowId) {
        tabInfo.lastActive = Date.now()
      }
    }
  }

  setTabTopicTags(tabId: number, tags: string[]): void {
    const tab = this.tabIndex.get(tabId)
    if (tab) {
      tab.topicTags = tags
    }
  }

  private formatDate(timestamp?: number): string {
    if (!timestamp) return 'unknown'

    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)

    if (diffHours < 1) return 'just now'
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`

    const diffDays = diffHours / 24
    if (diffDays < 7) return `${Math.floor(diffDays)}d ago`

    return date.toLocaleDateString()
  }
}
