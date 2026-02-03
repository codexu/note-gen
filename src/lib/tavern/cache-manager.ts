/**
 * 缓存管理器
 * 支持 LRU 缓存策略、TTL 过期、缓存统计
 * 用于优化世界书扫描、上下文构建等性能
 */

// ============================================================================
// Types
// ============================================================================

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T
  createdAt: number
  lastAccess: number
  accessCount: number
  size: number
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 最大条目数 */
  maxEntries: number
  /** TTL 过期时间 (毫秒, 0=永不过期) */
  ttl: number
  /** 是否启用统计 */
  enableStats: boolean
}

/**
 * 缓存统计
 */
export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  size: number
  entries: number
  hitRate: number
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 100,
  ttl: 5 * 60 * 1000, // 5 分钟
  enableStats: true,
}

// ============================================================================
// LRU Cache Manager
// ============================================================================

/**
 * LRU 缓存管理器
 */
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private config: CacheConfig
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    entries: 0,
    hitRate: 0,
  }

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 获取缓存
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    
    if (!entry) {
      if (this.config.enableStats) {
        this.stats.misses++
        this.updateHitRate()
      }
      return undefined
    }

    // 检查 TTL
    if (this.config.ttl > 0 && Date.now() - entry.createdAt > this.config.ttl) {
      this.delete(key)
      if (this.config.enableStats) {
        this.stats.misses++
        this.updateHitRate()
      }
      return undefined
    }

    // 更新访问记录 (LRU)
    entry.lastAccess = Date.now()
    entry.accessCount++
    
    // 移动到末尾 (最近访问)
    this.cache.delete(key)
    this.cache.set(key, entry)

    if (this.config.enableStats) {
      this.stats.hits++
      this.updateHitRate()
    }

    return entry.value
  }

  /**
   * 设置缓存
   */
  set(key: string, value: T, size = 1): void {
    // 检查是否需要驱逐
    while (this.cache.size >= this.config.maxEntries) {
      this.evictOldest()
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      accessCount: 1,
      size,
    }

    this.cache.set(key, entry)

    if (this.config.enableStats) {
      this.stats.entries = this.cache.size
      this.stats.size += size
    }
  }

  /**
   * 检查是否存在
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    
    // 检查 TTL
    if (this.config.ttl > 0 && Date.now() - entry.createdAt > this.config.ttl) {
      this.delete(key)
      return false
    }
    
    return true
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry && this.config.enableStats) {
      this.stats.size -= entry.size
    }
    return this.cache.delete(key)
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
    if (this.config.enableStats) {
      this.stats.size = 0
      this.stats.entries = 0
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats, entries: this.cache.size }
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: this.stats.size,
      entries: this.cache.size,
      hitRate: 0,
    }
  }

  /**
   * 清理过期条目
   */
  cleanup(): number {
    if (this.config.ttl === 0) return 0

    const now = Date.now()
    let removed = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.config.ttl) {
        this.delete(key)
        removed++
      }
    }

    return removed
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * 驱逐最旧的条目 (LRU)
   */
  private evictOldest(): void {
    // Map 按插入顺序迭代，第一个是最旧的
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      this.delete(firstKey)
      if (this.config.enableStats) {
        this.stats.evictions++
      }
    }
  }

  /**
   * 更新命中率
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0
  }
}

// ============================================================================
// 全局缓存实例
// ============================================================================

/** 世界书扫描结果缓存 */
export const worldInfoScanCache = new CacheManager<unknown>({
  maxEntries: 50,
  ttl: 2 * 60 * 1000, // 2 分钟
  enableStats: true,
})

/** 上下文构建结果缓存 */
export const contextBuildCache = new CacheManager<unknown>({
  maxEntries: 20,
  ttl: 60 * 1000, // 1 分钟
  enableStats: true,
})

/** 模板渲染缓存 */
export const templateRenderCache = new CacheManager<string>({
  maxEntries: 100,
  ttl: 5 * 60 * 1000, // 5 分钟
  enableStats: true,
})

// ============================================================================
// Hash 工具
// ============================================================================

/**
 * 生成缓存键
 * 基于输入数据生成稳定的哈希键
 */
export function generateCacheKey(...args: unknown[]): string {
  const str = JSON.stringify(args)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `cache_${hash.toString(36)}`
}

/**
 * 生成内容哈希
 */
export function contentHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}
