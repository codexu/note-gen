/**
 * 世界书导入导出模块
 * 支持 ST 格式的世界书 JSON 文件
 */

import {
  TavernWorldInfo,
  TavernWorldInfoEntry,
  insertWorldInfo,
  insertWorldInfoEntry,
  getWorldInfoById,
  getWorldInfoEntries,
} from '@/db/tavern'

/**
 * ST 世界书条目格式
 */
interface STWorldInfoEntry {
  uid: number
  key: string[]
  keysecondary: string[]
  comment: string
  content: string
  constant: boolean
  selective: boolean
  selectiveLogic: number
  order: number
  position: number
  disable: boolean
  probability: number
  useProbability: boolean
  depth: number
  role: number
  sticky: number
  cooldown: number
  delay: number
  displayIndex: number
  group: string
  groupOverride: boolean
  groupWeight: number
  scanDepth?: number | null
  caseSensitive?: boolean | null
  matchWholeWords?: boolean | null
  excludeRecursion: boolean
  preventRecursion: boolean
  delayUntilRecursion: boolean
  automationId?: string
  vectorized?: boolean
  // ST 特有字段（可忽略）
  addMemo?: boolean
  ignoreBudget?: boolean
  matchPersonaDescription?: boolean
  matchCharacterDescription?: boolean
  matchCharacterPersonality?: boolean
  matchCharacterDepthPrompt?: boolean
  matchScenario?: boolean
  matchCreatorNotes?: boolean
  outletName?: string
  useGroupScoring?: boolean | null
  triggers?: string[]
  characterFilter?: {
    isExclude: boolean
    names: string[]
    tags: string[]
  }
}

/**
 * ST 世界书文件格式
 */
interface STWorldInfoFile {
  entries: Record<string, STWorldInfoEntry>
  // 可能存在的元数据
  name?: string
  description?: string
}

/**
 * 导入世界书结果
 */
interface ImportResult {
  success: boolean
  worldInfoId?: number
  entryCount?: number
  error?: string
}

/**
 * 从 JSON 导入世界书
 */
export async function importWorldInfoFromJson(
  jsonContent: string,
  name: string,
  scope: 'global' | 'character',
  cardId?: number | null
): Promise<ImportResult> {
  try {
    const data: STWorldInfoFile = JSON.parse(jsonContent)

    if (!data.entries || typeof data.entries !== 'object') {
      return { success: false, error: '无效的世界书格式：缺少 entries 字段' }
    }

    // 创建世界书
    const worldInfoId = await insertWorldInfo({
      name: name || data.name || '导入的世界书',
      description: data.description || '',
      scope,
      cardId: scope === 'character' ? cardId ?? null : null,
      enabled: true,
    })

    if (!worldInfoId) {
      return { success: false, error: '创建世界书失败' }
    }

    // 导入所有条目
    const entries = Object.values(data.entries)
    let entryCount = 0

    for (const entry of entries) {
      await insertWorldInfoEntry({
        worldInfoId,
        uid: entry.uid,
        keys: JSON.stringify(entry.key || []),
        secondaryKeys: JSON.stringify(entry.keysecondary || []),
        content: entry.content || '',
        comment: entry.comment || '',
        enabled: !entry.disable,
        constant: entry.constant ?? false,
        selective: entry.selective ?? false,
        selectiveLogic: entry.selectiveLogic ?? 0,
        order: entry.order ?? 0,
        position: entry.position ?? 0,
        depth: entry.depth ?? 4,
        probability: entry.probability ?? 100,
        group: entry.group || '',
        groupOverride: entry.groupOverride ?? false,
        groupWeight: entry.groupWeight ?? 100,
        scanDepth: entry.scanDepth ?? null,
        caseSensitive: entry.caseSensitive ?? false,
        matchWholeWords: entry.matchWholeWords ?? false,
        automationId: entry.automationId || '',
        excludeRecursion: entry.excludeRecursion ?? false,
        preventRecursion: entry.preventRecursion ?? false,
        vectorized: entry.vectorized ?? false,
        // V3 字段
        useRegex: true, // ST 默认支持正则
        role: entry.role ?? 0,
        useProbability: entry.useProbability ?? true,
        displayIndex: entry.displayIndex ?? 0,
        delayUntilRecursion: entry.delayUntilRecursion ?? false,
        sticky: entry.sticky ?? null,
        cooldown: entry.cooldown ?? null,
        delay: entry.delay ?? null,
      })
      entryCount++
    }

    return {
      success: true,
      worldInfoId,
      entryCount,
    }
  } catch (error) {
    console.error('导入世界书失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '解析 JSON 失败',
    }
  }
}

/**
 * 导出世界书为 JSON
 */
export async function exportWorldInfoToJson(worldInfoId: number): Promise<string | null> {
  try {
    const worldInfo = await getWorldInfoById(worldInfoId)
    if (!worldInfo) {
      console.error('世界书不存在:', worldInfoId)
      return null
    }

    const entries = await getWorldInfoEntries(worldInfoId)

    // 构建 ST 格式
    const stEntries: Record<string, STWorldInfoEntry> = {}

    for (const entry of entries) {
      stEntries[String(entry.uid)] = {
        uid: entry.uid,
        key: JSON.parse(entry.keys || '[]'),
        keysecondary: JSON.parse(entry.secondaryKeys || '[]'),
        comment: entry.comment || '',
        content: entry.content || '',
        constant: entry.constant,
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic,
        order: entry.order,
        position: entry.position,
        disable: !entry.enabled,
        probability: entry.probability,
        useProbability: entry.useProbability,
        depth: entry.depth,
        role: entry.role,
        sticky: entry.sticky ?? 0,
        cooldown: entry.cooldown ?? 0,
        delay: entry.delay ?? 0,
        displayIndex: entry.displayIndex,
        group: entry.group || '',
        groupOverride: entry.groupOverride,
        groupWeight: entry.groupWeight,
        scanDepth: entry.scanDepth,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        excludeRecursion: entry.excludeRecursion,
        preventRecursion: entry.preventRecursion,
        delayUntilRecursion: entry.delayUntilRecursion,
        automationId: entry.automationId || '',
        vectorized: entry.vectorized,
        // ST 默认字段
        addMemo: true,
        ignoreBudget: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        outletName: '',
        useGroupScoring: null,
        triggers: [],
        characterFilter: {
          isExclude: false,
          names: [],
          tags: [],
        },
      }
    }

    const stFile: STWorldInfoFile = {
      entries: stEntries,
      name: worldInfo.name,
      description: worldInfo.description,
    }

    return JSON.stringify(stFile, null, 2)
  } catch (error) {
    console.error('导出世界书失败:', error)
    return null
  }
}
