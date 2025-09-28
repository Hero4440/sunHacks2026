// Context Bundler - Prepares AI-ready payloads with privacy protection
// Bundles page context while respecting token limits and PII masking

import type { NebulaStorage } from './storage'

export interface PageData {
  title: string
  url: string
  headings: Array<{ text: string; level: number }>
  selection?: string
  metadata?: Record<string, string>
}

export interface ContextBundle {
  title: string
  url: string
  headings: string[]
  selection?: string
  timeline: Array<{ title: string; url: string; tldr?: string; timestamp: number }>
  topicTags: string[]
  timestamp: number
  tokenCount: number
  baseTokens: number
}

export class ContextBundler {
  constructor(private storage?: NebulaStorage) {}

  private readonly MAX_TOKENS = 2500
  private readonly HEADING_PREVIEW_LENGTH = 200
  private readonly SELECTION_MAX_LENGTH = 1000

  getTokenLimit(): number {
    return this.MAX_TOKENS
  }

  async bundle(pageData: PageData): Promise<ContextBundle> {
    if (!pageData) {
      throw new Error('No page data provided for bundling')
    }

    // Get timeline from storage
    const timeline = await this.getTimeline()

    // Get topic tags for current URL
    const topicTags = await this.getTopicTags(pageData.url)

    // Mask PII in all text content
    const maskedPageData = this.maskPII(pageData)

    // Build initial bundle
    let bundle: ContextBundle = {
      title: maskedPageData.title,
      url: this.hashUrl(maskedPageData.url), // Hash URL for privacy
      headings: this.formatHeadings(maskedPageData.headings),
      selection: maskedPageData.selection,
      timeline: timeline.map(item => ({
        ...item,
        url: this.hashUrl(item.url)
      })),
      topicTags,
      timestamp: Date.now(),
      tokenCount: 0,
      baseTokens: 0
    }

    // Calculate token count and trim if needed
    bundle = this.trimToTokenLimit(bundle)

    console.log('Context bundle created:', {
      tokens: bundle.tokenCount,
      headings: bundle.headings.length,
      hasSelection: !!bundle.selection,
      timelineLength: bundle.timeline.length,
      topicTags: bundle.topicTags.length
    })

    return bundle
  }

  private maskPII(pageData: PageData): PageData {
    return {
      ...pageData,
      title: this.maskTextPII(pageData.title),
      headings: pageData.headings.map(h => ({
        ...h,
        text: this.maskTextPII(h.text)
      })),
      selection: pageData.selection ? this.maskTextPII(pageData.selection) : undefined
    }
  }

  private maskTextPII(text: string): string {
    let masked = text

    // Email addresses
    masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')

    // Phone numbers (various formats)
    masked = masked.replace(/\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g, '[PHONE]')

    // SSN
    masked = masked.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')

    // Credit card numbers (basic pattern)
    masked = masked.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')

    // Street addresses (basic pattern)
    masked = masked.replace(/\b\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Place|Pl)\b/gi, '[ADDRESS]')

    return masked
  }

  private formatHeadings(headings: Array<{ text: string; level: number }>): string[] {
    return headings
      .filter(h => h.text.trim().length > 0)
      .slice(0, 3) // Max 3 headings
      .map(h => {
        const preview = h.text.length > this.HEADING_PREVIEW_LENGTH
          ? h.text.substring(0, this.HEADING_PREVIEW_LENGTH) + '...'
          : h.text
        return `H${h.level}: ${preview}`
      })
  }

  private trimToTokenLimit(bundle: ContextBundle): ContextBundle {
    // Rough token estimation (1 token ≈ 4 characters)
    const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

    let currentTokens = 0
    let baseTokens = 0

    // Count base tokens
    const titleTokens = estimateTokens(bundle.title)
    const urlTokens = estimateTokens(bundle.url)
    const tagTokens = bundle.topicTags.reduce((sum, tag) => sum + estimateTokens(tag), 0)
    currentTokens += titleTokens + urlTokens + tagTokens
    baseTokens = currentTokens

    // Add headings
    let headingsTokens = 0
    const includedHeadings: string[] = []

    for (const heading of bundle.headings) {
      const headingTokens = estimateTokens(heading)
      if (currentTokens + headingsTokens + headingTokens < this.MAX_TOKENS * 0.6) {
        includedHeadings.push(heading)
        headingsTokens += headingTokens
      } else {
        break
      }
    }

    currentTokens += headingsTokens

    // Add selection if it fits
    let selection = bundle.selection
    if (selection) {
      const selectionTokens = estimateTokens(selection)
      if (currentTokens + selectionTokens > this.MAX_TOKENS * 0.8) {
        // Truncate selection
        const maxSelectionChars = (this.MAX_TOKENS * 0.8 - currentTokens) * 4
        if (maxSelectionChars > 100) {
          selection = selection.substring(0, Math.floor(maxSelectionChars)) + '...'
        } else {
          selection = undefined
        }
      }
      if (selection) {
        currentTokens += estimateTokens(selection)
      }
    }

    // Add timeline items that fit
    const includedTimeline: ContextBundle['timeline'] = []
    for (const item of bundle.timeline) {
      const itemTokens = estimateTokens(item.title + (item.tldr || ''))
      if (currentTokens + itemTokens < this.MAX_TOKENS * 0.9) {
        includedTimeline.push(item)
        currentTokens += itemTokens
      } else {
        break
      }
    }

    return {
      ...bundle,
      headings: includedHeadings,
      selection,
      timeline: includedTimeline,
      tokenCount: currentTokens,
      baseTokens
    }
  }

  private async getTimeline(): Promise<Array<{ title: string; url: string; tldr?: string; timestamp: number }>> {
    try {
      if (this.storage) {
        const entries = await this.storage.getTimeline()
        return entries.map(entry => ({
          title: entry.title,
          url: entry.url,
          tldr: entry.tldr,
          timestamp: entry.timestamp
        }))
      }

      const result = await chrome.storage.local.get('nebulaTimeline')
      return result.nebulaTimeline || []
    } catch (error) {
      console.error('Error getting timeline:', error)
      return []
    }
  }

  private async getTopicTags(url: string): Promise<string[]> {
    try {
      if (this.storage) {
        return await this.storage.getTopicTags(url)
      }

      const urlHash = this.hashUrl(url)
      const result = await chrome.storage.local.get('nebulaTopicTags')
      const topicTags = result.nebulaTopicTags || {}
      return topicTags[urlHash] || []
    } catch (error) {
      console.error('Error getting topic tags:', error)
      return []
    }
  }

  private hashUrl(url: string): string {
    // Simple hash function for privacy (in production, use crypto.subtle)
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  async updateTimeline(pageData: PageData, tldr?: string): Promise<void> {
    try {
      const entry = {
        title: this.maskTextPII(pageData.title),
        url: pageData.url,
        tldr: tldr ? this.maskTextPII(tldr) : undefined
      }

      if (this.storage) {
        await this.storage.addTimelineEntry(entry)
      } else {
        const timeline = await this.getTimeline()
        const newEntry = {
          ...entry,
          timestamp: Date.now()
        }

        const updatedTimeline = [newEntry, ...timeline.slice(0, 4)]
        await chrome.storage.local.set({ nebulaTimeline: updatedTimeline })
      }
    } catch (error) {
      console.error('Error updating timeline:', error)
    }
  }

  async updateTopicTags(url: string, tags: string[]): Promise<void> {
    try {
      const sanitizedTags = tags.map(tag => this.maskTextPII(tag))

      if (this.storage) {
        await this.storage.setTopicTags(url, sanitizedTags)
      } else {
        const urlHash = this.hashUrl(url)
        const result = await chrome.storage.local.get('nebulaTopicTags')
        const topicTags = result.nebulaTopicTags || {}

        topicTags[urlHash] = sanitizedTags

        await chrome.storage.local.set({ nebulaTopicTags: topicTags })
      }
    } catch (error) {
      console.error('Error updating topic tags:', error)
    }
  }
}
