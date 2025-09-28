// Storage Wrapper - IndexedDB abstraction for timeline and cache data
// Provides type-safe storage with automatic cleanup and data expiration

import { openDB, DBSchema, IDBPDatabase } from 'idb'

export interface TimelineEntry {
  id?: number
  url: string
  title: string
  tldr?: string
  timestamp: number
  urlHash: string
}

export interface TopicTag {
  id?: number
  urlHash: string
  tags: string[]
  lastUpdated: number
}

export interface CacheEntry {
  id?: number
  key: string
  data: any
  timestamp: number
  ttl: number // Time to live in milliseconds
}

export interface LogEntry {
  id?: number
  type: 'request' | 'response' | 'error' | 'action'
  payload: any
  timestamp: number
  hashId?: string
}

interface NebulaDB extends DBSchema {
  timeline: {
    key: number
    value: TimelineEntry
    indexes: { 'by-timestamp': number; 'by-url-hash': string }
  }
  topicTags: {
    key: number
    value: TopicTag
    indexes: { 'by-url-hash': string; 'by-last-updated': number }
  }
  cache: {
    key: number
    value: CacheEntry
    indexes: { 'by-key': string; 'by-timestamp': number }
  }
  logs: {
    key: number
    value: LogEntry
    indexes: { 'by-timestamp': number; 'by-type': string; 'by-hash-id': string }
  }
}

export class NebulaStorage {
  private db: IDBPDatabase<NebulaDB> | null = null
  private readonly DB_NAME = 'nebula-storage'
  private readonly DB_VERSION = 1
  private readonly MAX_TIMELINE_ENTRIES = 5
  private readonly MAX_LOG_ENTRIES = 100
  private readonly LOG_RETENTION_HOURS = 24

  async init(): Promise<void> {
    if (this.db) return

    try {
      this.db = await openDB<NebulaDB>(this.DB_NAME, this.DB_VERSION, {
        upgrade(db) {
          // Timeline store
          const timelineStore = db.createObjectStore('timeline', {
            keyPath: 'id',
            autoIncrement: true
          })
          timelineStore.createIndex('by-timestamp', 'timestamp')
          timelineStore.createIndex('by-url-hash', 'urlHash')

          // Topic tags store
          const topicTagsStore = db.createObjectStore('topicTags', {
            keyPath: 'id',
            autoIncrement: true
          })
          topicTagsStore.createIndex('by-url-hash', 'urlHash')
          topicTagsStore.createIndex('by-last-updated', 'lastUpdated')

          // Cache store
          const cacheStore = db.createObjectStore('cache', {
            keyPath: 'id',
            autoIncrement: true
          })
          cacheStore.createIndex('by-key', 'key')
          cacheStore.createIndex('by-timestamp', 'timestamp')

          // Logs store
          const logsStore = db.createObjectStore('logs', {
            keyPath: 'id',
            autoIncrement: true
          })
          logsStore.createIndex('by-timestamp', 'timestamp')
          logsStore.createIndex('by-type', 'type')
          logsStore.createIndex('by-hash-id', 'hashId')
        }
      })

      // Start cleanup task
      this.startPeriodicCleanup()

      console.log('Nebula storage initialized')
    } catch (error) {
      console.error('Error initializing Nebula storage:', error)
      throw error
    }
  }

  // Timeline methods
  async addTimelineEntry(entry: Omit<TimelineEntry, 'id' | 'timestamp' | 'urlHash'>): Promise<void> {
    if (!this.db) await this.init()

    const urlHash = this.hashUrl(entry.url)
    const timelineEntry: TimelineEntry = {
      ...entry,
      timestamp: Date.now(),
      urlHash
    }

    const tx = this.db!.transaction('timeline', 'readwrite')
    await tx.store.add(timelineEntry)

    // Keep only the most recent entries
    await this.pruneTimeline()
  }

  async getTimeline(): Promise<TimelineEntry[]> {
    if (!this.db) await this.init()

    const entries = await this.db!.getAll('timeline')
    return entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.MAX_TIMELINE_ENTRIES)
  }

  async getTimelineByUrlHash(urlHash: string): Promise<TimelineEntry | undefined> {
    if (!this.db) await this.init()

    return await this.db!.getFromIndex('timeline', 'by-url-hash', urlHash)
  }

  private async pruneTimeline(): Promise<void> {
    if (!this.db) return

    const entries = await this.db.getAll('timeline')
    if (entries.length <= this.MAX_TIMELINE_ENTRIES) return

    // Sort by timestamp and remove oldest entries
    const sortedEntries = entries.sort((a, b) => b.timestamp - a.timestamp)
    const entriesToDelete = sortedEntries.slice(this.MAX_TIMELINE_ENTRIES)

    const tx = this.db.transaction('timeline', 'readwrite')
    for (const entry of entriesToDelete) {
      if (entry.id) {
        await tx.store.delete(entry.id)
      }
    }
  }

  // Topic tags methods
  async setTopicTags(url: string, tags: string[]): Promise<void> {
    if (!this.db) await this.init()

    const db = this.db!
    const urlHash = this.hashUrl(url)
    const existing = await db.getFromIndex('topicTags', 'by-url-hash', urlHash)

    const topicTag: TopicTag = {
      urlHash,
      tags,
      lastUpdated: Date.now()
    }

    const tx = db.transaction('topicTags', 'readwrite')

    if (existing) {
      topicTag.id = existing.id
      await tx.store.put(topicTag)
    } else {
      await tx.store.add(topicTag)
    }
  }

  async getTopicTags(url: string): Promise<string[]> {
    if (!this.db) await this.init()

    const urlHash = this.hashUrl(url)
    const entry = await this.db!.getFromIndex('topicTags', 'by-url-hash', urlHash)
    return entry?.tags || []
  }

  async getAllTopicTags(): Promise<TopicTag[]> {
    if (!this.db) await this.init()

    return await this.db!.getAll('topicTags')
  }

  // Cache methods
  async setCache(key: string, data: any, ttl: number = 300000): Promise<void> {
    if (!this.db) await this.init()

    const db = this.db!
    const existing = await db.getFromIndex('cache', 'by-key', key)

    const cacheEntry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
      ttl
    }

    const tx = db.transaction('cache', 'readwrite')

    if (existing) {
      cacheEntry.id = existing.id
      await tx.store.put(cacheEntry)
    } else {
      await tx.store.add(cacheEntry)
    }
  }

  async getCache(key: string): Promise<any | null> {
    if (!this.db) await this.init()

    const db = this.db!
    const entry = await db.getFromIndex('cache', 'by-key', key)
    if (!entry) return null

    // Check if cache entry has expired
    const isExpired = Date.now() - entry.timestamp > entry.ttl
    if (isExpired) {
      // Remove expired entry
      if (entry.id) {
        const tx = db.transaction('cache', 'readwrite')
        await tx.store.delete(entry.id)
      }
      return null
    }

    return entry.data
  }

  async clearCache(): Promise<void> {
    if (!this.db) await this.init()

    const db = this.db!
    const tx = db.transaction('cache', 'readwrite')
    await tx.store.clear()
  }

  // Logging methods
  async addLog(
    type: LogEntry['type'],
    payload: any,
    hashId?: string
  ): Promise<void> {
    if (!this.db) await this.init()

    const logEntry: LogEntry = {
      type,
      payload,
      timestamp: Date.now(),
      hashId
    }

    const tx = this.db!.transaction('logs', 'readwrite')
    await tx.store.add(logEntry)

    // Keep log size manageable
    await this.pruneLogs()
  }

  async getLogs(options?: {
    type?: LogEntry['type']
    hashId?: string
    limit?: number
  }): Promise<LogEntry[]> {
    if (!this.db) await this.init()

    let logs: LogEntry[]

    if (options?.type) {
      logs = await this.db!.getAllFromIndex('logs', 'by-type', options.type)
    } else if (options?.hashId) {
      logs = await this.db!.getAllFromIndex('logs', 'by-hash-id', options.hashId)
    } else {
      logs = await this.db!.getAll('logs')
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => b.timestamp - a.timestamp)

    if (options?.limit) {
      logs = logs.slice(0, options.limit)
    }

    return logs
  }

  private async pruneLogs(): Promise<void> {
    const db = this.db
    if (!db) return

    const cutoffTime = Date.now() - (this.LOG_RETENTION_HOURS * 60 * 60 * 1000)
    const tx = db.transaction('logs', 'readwrite')
    const index = tx.store.index('by-timestamp')

    // Delete logs older than retention period
    const range = IDBKeyRange.upperBound(cutoffTime)
    let cursor = await index.openCursor(range)
    while (cursor) {
      cursor.delete()
      cursor = await cursor.continue()
    }

    // Also limit total number of logs
    const allLogs = await db.getAll('logs')
    if (allLogs.length > this.MAX_LOG_ENTRIES) {
      const sortedLogs = allLogs.sort((a, b) => b.timestamp - a.timestamp)
      const logsToDelete = sortedLogs.slice(this.MAX_LOG_ENTRIES)

      const deleteTx = db.transaction('logs', 'readwrite')
      for (const log of logsToDelete) {
        if (log.id) {
          await deleteTx.store.delete(log.id)
        }
      }
    }
  }

  // General cleanup methods
  async forgetAll(): Promise<void> {
    if (!this.db) await this.init()

    const tx = this.db!.transaction(['timeline', 'topicTags', 'cache', 'logs'], 'readwrite')

    await Promise.all([
      tx.objectStore('timeline').clear(),
      tx.objectStore('topicTags').clear(),
      tx.objectStore('cache').clear(),
      tx.objectStore('logs').clear()
    ])

    console.log('All Nebula data forgotten')
  }

  private startPeriodicCleanup(): void {
    // Run cleanup every hour
    setInterval(() => {
      this.performCleanup()
    }, 60 * 60 * 1000)

    // Run initial cleanup after 5 minutes
    setTimeout(() => {
      this.performCleanup()
    }, 5 * 60 * 1000)
  }

  private async performCleanup(): Promise<void> {
    if (!this.db) return

    try {
      await Promise.all([
        this.pruneTimeline(),
        this.pruneLogs(),
        this.cleanExpiredCache()
      ])

      console.log('Periodic cleanup completed')
    } catch (error) {
      console.error('Error during periodic cleanup:', error)
    }
  }

  private async cleanExpiredCache(): Promise<void> {
    if (!this.db) return

    const allCache = await this.db.getAll('cache')
    const now = Date.now()
    const expiredEntries = allCache.filter(entry =>
      now - entry.timestamp > entry.ttl
    )

    if (expiredEntries.length > 0) {
      const tx = this.db.transaction('cache', 'readwrite')
      for (const entry of expiredEntries) {
        if (entry.id) {
          await tx.store.delete(entry.id)
        }
      }
    }
  }

  private hashUrl(url: string): string {
    // Simple hash function for URL privacy
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }
}

// Export singleton instance
export const nebulaStorage = new NebulaStorage()
