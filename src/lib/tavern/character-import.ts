import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { copyFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import {
  insertCard,
  insertWorldInfo,
  insertWorldInfoEntry,
  insertRegex,
  getCardById,
  TavernCard,
} from '@/db/tavern'

// Rust 解析结果类型
export interface PngParseResult {
  success: boolean
  error?: string
  version?: 'v1' | 'v2' | 'v3'
  data?: CharacterCardData
  raw_text?: string
}

// V3 深度提示词结构
export interface DepthPrompt {
  prompt?: string
  depth?: number
  role?: 'system' | 'user' | 'assistant'
}

// V2/V3 角色卡数据结构
export interface CharacterCardData {
  spec?: string
  spec_version?: string
  data: {
    name?: string
    description?: string
    personality?: string
    scenario?: string
    first_mes?: string
    mes_example?: string
    creator_notes?: string
    system_prompt?: string
    post_history_instructions?: string
    alternate_greetings?: string[]
    group_only_greetings?: string[]  // V3 仅群聊问候语
    tags?: string[]
    creator?: string
    character_version?: string
    extensions?: {
      talkativeness?: number
      fav?: boolean
      world?: string
      depth_prompt?: DepthPrompt
      regex_scripts?: RegexScript[]
      [key: string]: unknown
    }
    character_book?: CharacterBook
  }
}

// 内嵌世界书
export interface CharacterBook {
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
  entries?: WorldInfoEntry[]
  extensions?: Record<string, unknown>
}

// 世界书条目
export interface WorldInfoEntry {
  keys?: string[]
  secondary_keys?: string[]
  content?: string
  extensions?: {
    position?: number
    exclude_recursion?: boolean
    prevent_recursion?: boolean
    delay_until_recursion?: boolean
    probability?: number
    useProbability?: boolean
    depth?: number
    selectiveLogic?: number
    group?: string
    group_override?: boolean
    group_weight?: number
    scan_depth?: number | null
    match_whole_words?: boolean | null
    use_group_scoring?: boolean | null
    case_sensitive?: boolean | null
    automation_id?: string
    role?: number
    vectorized?: boolean
    display_index?: number
    sticky?: number | null
    cooldown?: number | null
    delay?: number | null
    [key: string]: unknown
  }
  enabled?: boolean
  insertion_order?: number
  case_sensitive?: boolean
  name?: string
  priority?: number
  id?: number
  comment?: string
  selective?: boolean
  constant?: boolean
  position?: number | string  // 可能是 'before_char' 或 'after_char' 或数字
  use_regex?: boolean  // V3 正则匹配字段
}

// 正则脚本 (可能嵌入在 extensions 中)
export interface RegexScript {
  scriptName?: string
  findRegex: string
  replaceString?: string
  trimStrings?: string[]
  placement?: string[]
  disabled?: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  runOnEdit?: boolean
  substituteRegex?: boolean
  minDepth?: number
  maxDepth?: number
}

// 导入结果
export interface ImportResult {
  success: boolean
  cardId?: number
  cardName?: string
  worldInfoCount?: number
  regexCount?: number
  error?: string
}

/**
 * 调用 Rust 解析 PNG 角色卡
 */
export async function parseCharacterPng(filePath: string): Promise<PngParseResult> {
  console.log('[Tavern] Calling parse_character_png with path:', filePath)
  try {
    const result = await invoke<PngParseResult>('parse_character_png', { filePath })
    console.log('[Tavern] parse_character_png result:', result)
    return result
  } catch (error) {
    console.error('[Tavern] parse_character_png error:', error)
    throw error
  }
}

/**
 * 批量解析多个 PNG 文件
 */
export async function parseCharacterPngs(filePaths: string[]): Promise<PngParseResult[]> {
  return await invoke<PngParseResult[]>('parse_character_pngs', { filePaths })
}

/**
 * 打开文件选择对话框选择角色卡
 */
export async function selectCharacterFiles(): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: 'Character Cards',
        extensions: ['png'],
      },
    ],
  })

  if (!selected) return null

  // 确保返回数组
  return Array.isArray(selected) ? selected : [selected]
}

/**
 * 确保头像目录存在
 */
async function ensureAvatarDir(): Promise<string> {
  const dataDir = await appDataDir()
  const avatarDir = await join(dataDir, 'tavern', 'avatars')

  if (!(await exists(avatarDir))) {
    await mkdir(avatarDir, { recursive: true })
  }

  return avatarDir
}

/**
 * 复制角色卡图片作为头像
 */
async function saveAvatar(sourcePath: string, cardName: string): Promise<string> {
  const avatarDir = await ensureAvatarDir()
  const timestamp = Date.now()
  const safeFileName = cardName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')
  const avatarFileName = `${safeFileName}_${timestamp}.png`
  const avatarPath = await join(avatarDir, avatarFileName)

  await copyFile(sourcePath, avatarPath)

  return avatarPath
}

/**
 * 导入单个角色卡
 */
export async function importCharacter(filePath: string): Promise<ImportResult> {
  try {
    // 1. 解析 PNG 文件
    const parseResult = await parseCharacterPng(filePath)

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error || '解析失败',
      }
    }

    const cardData = parseResult.data.data

    // 2. 验证必要字段
    if (!cardData.name) {
      return {
        success: false,
        error: '角色卡缺少名称',
      }
    }

    // 3. 复制头像
    const avatarPath = await saveAvatar(filePath, cardData.name)

    // 4. 提取 V3 扩展字段
    const extensions = cardData.extensions || {}
    const depthPrompt = extensions.depth_prompt as DepthPrompt | undefined

    // 5. 插入角色卡到数据库
    const cardId = await insertCard({
      name: cardData.name,
      description: cardData.description || '',
      personality: cardData.personality || '',
      scenario: cardData.scenario || '',
      firstMes: cardData.first_mes || '',
      mesExample: cardData.mes_example || '',
      creatorNotes: cardData.creator_notes || '',
      systemPrompt: cardData.system_prompt || '',
      postHistoryInstructions: cardData.post_history_instructions || '',
      alternateGreetings: JSON.stringify(cardData.alternate_greetings || []),
      groupOnlyGreetings: JSON.stringify(cardData.group_only_greetings || []),
      tags: JSON.stringify(cardData.tags || []),
      creator: cardData.creator || '',
      characterVersion: cardData.character_version || '',
      extensions: JSON.stringify(extensions),
      characterBook: cardData.character_book ? JSON.stringify(cardData.character_book) : '',
      avatarPath: avatarPath,
      presetId: null,
      // V3 扩展字段
      depthPromptText: depthPrompt?.prompt || '',
      depthPromptDepth: depthPrompt?.depth ?? 4,
      depthPromptRole: depthPrompt?.role || 'system',
      linkedWorld: (extensions.world as string) || '',
      talkativeness: (extensions.talkativeness as number) ?? 0.5,
      isFavorite: Boolean(extensions.fav),
      sourceUrl: '',
    })

    let worldInfoCount = 0
    let regexCount = 0

    // 6. 处理内嵌世界书
    if (cardData.character_book?.entries && cardData.character_book.entries.length > 0) {
      const worldInfoId = await insertWorldInfo({
        name: cardData.character_book.name || `${cardData.name} 的世界书`,
        description: cardData.character_book.description || '',
        scope: 'character',
        cardId: cardId!,
        enabled: true,
      })

      for (let i = 0; i < cardData.character_book.entries.length; i++) {
        const entry = cardData.character_book.entries[i]
        const ext = entry.extensions || {}
        
        // 解析 position: 可能是字符串 'before_char'/'after_char' 或数字
        let positionNum = 0
        if (typeof entry.position === 'string') {
          positionNum = entry.position === 'before_char' ? 0 : 1
        } else if (typeof entry.position === 'number') {
          positionNum = entry.position
        } else if (typeof ext.position === 'number') {
          positionNum = ext.position
        }

        await insertWorldInfoEntry({
          worldInfoId: worldInfoId!,
          uid: entry.id ?? i,
          keys: JSON.stringify(entry.keys || []),
          secondaryKeys: JSON.stringify(entry.secondary_keys || []),
          content: entry.content || '',
          comment: entry.comment || entry.name || '',
          enabled: entry.enabled !== false,
          constant: entry.constant || false,
          selective: entry.selective || false,
          selectiveLogic: ext.selectiveLogic ?? 0,
          order: entry.insertion_order ?? 0,
          position: positionNum,
          depth: ext.depth ?? 4,
          probability: ext.probability ?? 100,
          group: ext.group || '',
          groupOverride: ext.group_override || false,
          groupWeight: ext.group_weight ?? 100,
          scanDepth: ext.scan_depth ?? cardData.character_book.scan_depth ?? null,
          caseSensitive: ext.case_sensitive ?? entry.case_sensitive ?? false,
          matchWholeWords: ext.match_whole_words ?? false,
          automationId: ext.automation_id || '',
          excludeRecursion: ext.exclude_recursion || false,
          preventRecursion: ext.prevent_recursion || false,
          vectorized: ext.vectorized || false,
          // V3/ST 高级字段
          useRegex: entry.use_regex !== false, // ST 默认 true
          role: ext.role ?? 0,
          useProbability: ext.useProbability !== false,
          displayIndex: ext.display_index ?? i,
          delayUntilRecursion: ext.delay_until_recursion || false,
          sticky: ext.sticky ?? null,
          cooldown: ext.cooldown ?? null,
          delay: ext.delay ?? null,
        })
        worldInfoCount++
      }
    }

    // 7. 处理内嵌正则脚本 (如果存在于 extensions 中)
    if (extensions.regex_scripts) {
      const regexScripts = extensions.regex_scripts as RegexScript[]
      for (const regex of regexScripts) {
        await insertRegex({
          name: regex.scriptName || 'Unnamed Regex',
          scriptName: regex.scriptName || '',
          findRegex: regex.findRegex,
          replaceString: regex.replaceString || '',
          trimStrings: JSON.stringify(regex.trimStrings || []),
          placement: JSON.stringify(regex.placement || []),
          disabled: regex.disabled || false,
          markdownOnly: regex.markdownOnly || false,
          promptOnly: regex.promptOnly || false,
          runOnEdit: regex.runOnEdit || false,
          substituteRegex: regex.substituteRegex || false,
          minDepth: regex.minDepth || null,
          maxDepth: regex.maxDepth || null,
          cardId: cardId!,
          presetId: null,
        })
        regexCount++
      }
    }

    return {
      success: true,
      cardId: cardId!,
      cardName: cardData.name,
      worldInfoCount,
      regexCount,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 批量导入多个角色卡
 */
export async function importCharacters(filePaths: string[]): Promise<ImportResult[]> {
  const results: ImportResult[] = []

  for (const filePath of filePaths) {
    const result = await importCharacter(filePath)
    results.push(result)
  }

  return results
}

/**
 * 一键导入：打开选择对话框并导入
 */
export async function selectAndImportCharacters(): Promise<ImportResult[] | null> {
  const files = await selectCharacterFiles()

  if (!files || files.length === 0) {
    return null
  }

  return await importCharacters(files)
}

// ============ 导出功能 ============

/**
 * 将数据库中的角色卡转换为 V2/V3 Spec JSON
 * 导出时将独立字段合并回 extensions
 */
export function cardToV2Json(card: TavernCard): string {
  // 解析已有的 extensions
  const existingExtensions = JSON.parse(card.extensions || '{}')
  
  // 合并 V3 字段到 extensions
  const extensions = {
    ...existingExtensions,
    talkativeness: card.talkativeness ?? 0.5,
    fav: card.isFavorite ?? false,
    world: card.linkedWorld || '',
    depth_prompt: {
      prompt: card.depthPromptText || '',
      depth: card.depthPromptDepth ?? 4,
      role: card.depthPromptRole || 'system',
    },
  }

  const v2Data = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMes,
      mes_example: card.mesExample,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: JSON.parse(card.alternateGreetings || '[]'),
      group_only_greetings: JSON.parse(card.groupOnlyGreetings || '[]'),
      tags: JSON.parse(card.tags || '[]'),
      creator: card.creator,
      character_version: card.characterVersion,
      extensions: extensions,
      character_book: card.characterBook ? JSON.parse(card.characterBook) : undefined,
    },
  }
  return JSON.stringify(v2Data, null, 2)
}

/**
 * 导出角色卡为 PNG 文件
 */
export async function exportCharacterPng(
  cardId: number,
  outputPath?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    // 1. 获取角色卡数据
    const card = await getCardById(cardId)
    if (!card) {
      return { success: false, error: '角色卡不存在' }
    }

    // 2. 检查头像文件是否存在
    if (!card.avatarPath || !(await exists(card.avatarPath))) {
      return { success: false, error: '角色卡没有头像图片' }
    }

    // 3. 选择保存路径
    let savePath = outputPath
    if (!savePath) {
      const selected = await save({
        defaultPath: `${card.name}.png`,
        filters: [
          {
            name: 'Character Card',
            extensions: ['png'],
          },
        ],
      })
      if (!selected) {
        return { success: false, error: '用户取消' }
      }
      savePath = selected
    }

    // 4. 转换为 V2 JSON
    const characterJson = cardToV2Json(card)

    // 5. 调用 Rust 导出
    await invoke('export_character_png', {
      sourcePngPath: card.avatarPath,
      outputPath: savePath,
      characterJson,
    })

    return { success: true, path: savePath }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 一键导出：选择保存路径并导出
 */
export async function selectAndExportCharacter(
  cardId: number
): Promise<{ success: boolean; path?: string; error?: string }> {
  return await exportCharacterPng(cardId)
}
