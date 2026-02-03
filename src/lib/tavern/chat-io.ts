/**
 * Chat IO Service - 聊天导入导出服务
 * 
 * 支持 SillyTavern JSONL 格式的聊天文件导入导出
 * 同时支持自定义 JSON 格式
 */

import {
  TavernChat,
  TavernMessage,
  TavernCard,
  TavernPersona,
  getMessagesByChatId,
  getChatById,
  getCardById,
  insertChat,
  insertMessage,
  getDefaultPersona,
} from '@/db/tavern'

// ============ 类型定义 ============

/**
 * ST 聊天文件元数据 (JSONL 第一行)
 */
export interface STChatMetadata {
  user_name: string
  character_name: string
  create_date: string
  chat_metadata?: {
    tainted?: boolean
    timedWorldInfo?: unknown
    [key: string]: unknown
  }
}

/**
 * ST 消息格式
 */
export interface STMessage {
  name: string
  is_user: boolean
  is_system?: boolean
  send_date: number | string
  mes: string
  swipe_id?: number
  swipes?: string[]
  swipe_info?: Array<{
    send_date?: number
    gen_started?: number
    gen_finished?: number
    extra?: Record<string, unknown>
  }>
  extra?: {
    api?: string
    model?: string
    token_count?: number
    reasoning?: string
    reasoning_duration?: number
    [key: string]: unknown
  }
  gen_started?: number
  gen_finished?: number
  force_avatar?: string
  original_avatar?: string
  is_name?: boolean
}

/**
 * 导出选项
 */
export interface ExportOptions {
  format: 'st_jsonl' | 'json'
  includeMetadata?: boolean
  characterName?: string
  userName?: string
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean
  chatId?: number
  messageCount?: number
  error?: string
  format?: 'st_jsonl' | 'json' | 'unknown'
}

/**
 * 导出结果
 */
export interface ExportResult {
  success: boolean
  data?: string
  filename?: string
  error?: string
}

// ============ ST JSONL 格式处理 ============

/**
 * 将 TavernMessage 转换为 ST 消息格式
 */
function convertToSTMessage(msg: TavernMessage, userName: string): STMessage {
  const swipes: string[] = msg.swipes ? JSON.parse(msg.swipes) : [msg.content]
  const swipeInfo = msg.swipeInfo ? JSON.parse(msg.swipeInfo) : []
  const extra = msg.extra ? JSON.parse(msg.extra) : {}
  
  return {
    name: msg.name,
    is_user: msg.role === 'user',
    is_system: msg.role === 'system',
    send_date: msg.sendDate,
    mes: msg.content,
    swipe_id: msg.swipeId,
    swipes: swipes.length > 1 ? swipes : undefined,
    swipe_info: swipeInfo.length > 0 ? swipeInfo.map((info: any) => ({
      send_date: info.sendDate,
      gen_started: info.genStarted,
      gen_finished: info.genFinished,
      extra: info.extra,
    })) : undefined,
    extra: Object.keys(extra).length > 0 ? {
      api: extra.api,
      model: extra.model,
      token_count: extra.tokenCount,
      reasoning: extra.reasoning,
      reasoning_duration: extra.reasoningDuration,
      ...extra,
    } : undefined,
    gen_started: msg.genStarted ?? undefined,
    gen_finished: msg.genFinished ?? undefined,
    force_avatar: msg.forceAvatar || undefined,
    original_avatar: msg.originalAvatar || undefined,
  }
}

/**
 * 将 ST 消息格式转换为 TavernMessage 格式 (用于导入)
 */
function convertFromSTMessage(stMsg: STMessage, chatId: number): Omit<TavernMessage, 'id' | 'createdAt'> {
  const role: 'user' | 'assistant' | 'system' = stMsg.is_system 
    ? 'system' 
    : stMsg.is_user 
      ? 'user' 
      : 'assistant'
  
  const swipes = stMsg.swipes || [stMsg.mes]
  const swipeInfo = stMsg.swipe_info?.map(info => ({
    sendDate: info.send_date,
    genStarted: info.gen_started,
    genFinished: info.gen_finished,
    extra: info.extra,
  })) || []
  
  const extra: Record<string, unknown> = {}
  if (stMsg.extra) {
    if (stMsg.extra.api) extra.api = stMsg.extra.api
    if (stMsg.extra.model) extra.model = stMsg.extra.model
    if (stMsg.extra.token_count) extra.tokenCount = stMsg.extra.token_count
    if (stMsg.extra.reasoning) extra.reasoning = stMsg.extra.reasoning
    if (stMsg.extra.reasoning_duration) extra.reasoningDuration = stMsg.extra.reasoning_duration
  }
  
  return {
    chatId,
    role,
    name: stMsg.name,
    content: stMsg.mes,
    isHidden: false,
    swipeId: stMsg.swipe_id || 0,
    swipes: JSON.stringify(swipes),
    sendDate: typeof stMsg.send_date === 'number' ? stMsg.send_date : Date.parse(stMsg.send_date) || Date.now(),
    genStarted: stMsg.gen_started ?? null,
    genFinished: stMsg.gen_finished ?? null,
    forceAvatar: stMsg.force_avatar || '',
    originalAvatar: stMsg.original_avatar || '',
    swipeInfo: JSON.stringify(swipeInfo),
    extra: JSON.stringify(extra),
  }
}

/**
 * 导出聊天为 ST JSONL 格式
 */
export async function exportChatAsSTJSONL(
  chatId: number,
  options?: Partial<ExportOptions>
): Promise<ExportResult> {
  try {
    const chat = await getChatById(chatId)
    if (!chat) {
      return { success: false, error: '聊天不存在' }
    }
    
    const messages = await getMessagesByChatId(chatId)
    if (messages.length === 0) {
      return { success: false, error: '聊天没有消息' }
    }
    
    // 获取角色信息
    const card = await getCardById(chat.cardId)
    const persona = await getDefaultPersona()
    
    const characterName = options?.characterName || card?.name || 'Character'
    const userName = options?.userName || persona?.name || 'User'
    
    // 构建 JSONL 内容
    const lines: string[] = []
    
    // 第一行: 元数据
    const metadata: STChatMetadata = {
      user_name: userName,
      character_name: characterName,
      create_date: new Date(chat.createdAt).toISOString(),
      chat_metadata: chat.metadata ? JSON.parse(chat.metadata) : undefined,
    }
    lines.push(JSON.stringify(metadata))
    
    // 后续行: 消息
    for (const msg of messages) {
      const stMsg = convertToSTMessage(msg, userName)
      lines.push(JSON.stringify(stMsg))
    }
    
    const data = lines.join('\n')
    const filename = `${characterName}_${chat.name}_${Date.now()}.jsonl`
    
    return { success: true, data, filename }
  } catch (error) {
    console.error('导出聊天失败:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : '导出失败' 
    }
  }
}

/**
 * 导入 ST JSONL 格式聊天
 */
export async function importSTJSONLChat(
  content: string,
  cardId: number,
  options?: { createNewChat?: boolean; targetChatId?: number }
): Promise<ImportResult> {
  try {
    const lines = content.trim().split('\n').filter(line => line.trim())
    if (lines.length < 2) {
      return { success: false, error: '无效的 JSONL 文件 (至少需要元数据和一条消息)' }
    }
    
    // 解析元数据
    let metadata: STChatMetadata
    try {
      metadata = JSON.parse(lines[0])
    } catch {
      return { success: false, error: '无法解析聊天元数据' }
    }
    
    // 创建或获取聊天
    let chatId: number
    if (options?.targetChatId) {
      chatId = options.targetChatId
    } else {
      const newChatId = await insertChat({
        cardId,
        groupId: null,
        name: `${metadata.character_name} - ${new Date().toLocaleDateString()}`,
        metadata: metadata.chat_metadata ? JSON.stringify(metadata.chat_metadata) : '',
        integrity: '',
      })
      if (!newChatId) {
        return { success: false, error: '创建聊天失败' }
      }
      chatId = newChatId
    }
    
    // 导入消息
    let importedCount = 0
    for (let i = 1; i < lines.length; i++) {
      try {
        const stMsg: STMessage = JSON.parse(lines[i])
        const msgData = convertFromSTMessage(stMsg, chatId)
        await insertMessage(msgData)
        importedCount++
      } catch (e) {
        console.warn(`跳过无效消息 (行 ${i + 1}):`, e)
      }
    }
    
    return {
      success: true,
      chatId,
      messageCount: importedCount,
      format: 'st_jsonl',
    }
  } catch (error) {
    console.error('导入聊天失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '导入失败',
    }
  }
}

// ============ 自定义 JSON 格式处理 ============

/**
 * 完整聊天导出数据
 */
export interface ChatExportData {
  version: '1.0'
  exportedAt: number
  chat: {
    name: string
    cardId: number
    cardName?: string
    metadata?: string
    createdAt: number
  }
  messages: TavernMessage[]
}

/**
 * 导出聊天为 JSON 格式
 */
export async function exportChatAsJSON(chatId: number): Promise<ExportResult> {
  try {
    const chat = await getChatById(chatId)
    if (!chat) {
      return { success: false, error: '聊天不存在' }
    }
    
    const messages = await getMessagesByChatId(chatId)
    const card = await getCardById(chat.cardId)
    
    const exportData: ChatExportData = {
      version: '1.0',
      exportedAt: Date.now(),
      chat: {
        name: chat.name,
        cardId: chat.cardId,
        cardName: card?.name,
        metadata: chat.metadata,
        createdAt: chat.createdAt,
      },
      messages,
    }
    
    const data = JSON.stringify(exportData, null, 2)
    const filename = `chat_${card?.name || 'export'}_${Date.now()}.json`
    
    return { success: true, data, filename }
  } catch (error) {
    console.error('导出聊天失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '导出失败',
    }
  }
}

/**
 * 导入 JSON 格式聊天
 */
export async function importJSONChat(
  content: string,
  cardId: number
): Promise<ImportResult> {
  try {
    const exportData: ChatExportData = JSON.parse(content)
    
    if (!exportData.version || !exportData.messages) {
      return { success: false, error: '无效的聊天导出文件' }
    }
    
    // 创建新聊天
    const newChatId = await insertChat({
      cardId,
      groupId: null,
      name: `${exportData.chat.name} (导入)`,
      metadata: exportData.chat.metadata || '',
      integrity: '',
    })
    
    if (!newChatId) {
      return { success: false, error: '创建聊天失败' }
    }
    
    // 导入消息
    for (const msg of exportData.messages) {
      await insertMessage({
        chatId: newChatId,
        role: msg.role,
        name: msg.name,
        content: msg.content,
        isHidden: msg.isHidden,
        swipeId: msg.swipeId,
        swipes: msg.swipes,
        sendDate: msg.sendDate,
        genStarted: msg.genStarted,
        genFinished: msg.genFinished,
        forceAvatar: msg.forceAvatar,
        originalAvatar: msg.originalAvatar,
        swipeInfo: msg.swipeInfo,
        extra: msg.extra,
      })
    }
    
    return {
      success: true,
      chatId: newChatId,
      messageCount: exportData.messages.length,
      format: 'json',
    }
  } catch (error) {
    console.error('导入聊天失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '导入失败',
    }
  }
}

// ============ 通用函数 ============

/**
 * 检测文件格式
 */
export function detectChatFormat(content: string): 'st_jsonl' | 'json' | 'unknown' {
  const trimmed = content.trim()
  
  // 检测 JSONL 格式 (多行 JSON)
  if (trimmed.includes('\n')) {
    const firstLine = trimmed.split('\n')[0]
    try {
      const parsed = JSON.parse(firstLine)
      if (parsed.user_name && parsed.character_name) {
        return 'st_jsonl'
      }
    } catch {
      // 不是 JSONL
    }
  }
  
  // 检测 JSON 格式
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed.version && parsed.messages) {
      return 'json'
    }
    // 可能是旧版备份格式
    if (parsed.id && parsed.messages && Array.isArray(parsed.messages)) {
      return 'json'
    }
  } catch {
    // 不是有效 JSON
  }
  
  return 'unknown'
}

/**
 * 自动检测并导入聊天
 */
export async function importChat(
  content: string,
  cardId: number
): Promise<ImportResult> {
  const format = detectChatFormat(content)
  
  switch (format) {
    case 'st_jsonl':
      return importSTJSONLChat(content, cardId)
    case 'json':
      return importJSONChat(content, cardId)
    default:
      return { success: false, error: '无法识别的文件格式' }
  }
}

/**
 * 导出聊天 (根据格式)
 */
export async function exportChat(
  chatId: number,
  options: ExportOptions
): Promise<ExportResult> {
  switch (options.format) {
    case 'st_jsonl':
      return exportChatAsSTJSONL(chatId, options)
    case 'json':
      return exportChatAsJSON(chatId)
    default:
      return { success: false, error: '不支持的导出格式' }
  }
}

/**
 * 下载导出文件
 */
export function downloadExport(result: ExportResult): void {
  if (!result.success || !result.data) return
  
  const blob = new Blob([result.data], { 
    type: result.filename?.endsWith('.jsonl') 
      ? 'application/x-ndjson' 
      : 'application/json' 
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename || `chat_export_${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 选择并读取文件 (使用 Tauri 对话框)
 */
export async function selectChatFile(): Promise<{ content: string; filename: string } | null> {
  try {
    // 动态导入 Tauri 插件
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    
    // 打开文件选择对话框
    const selected = await open({
      multiple: false,
      filters: [{
        name: '聊天文件',
        extensions: ['json', 'jsonl']
      }]
    })
    
    if (!selected) {
      return null
    }
    
    // 读取文件内容
    const path = typeof selected === 'string' ? selected : selected[0]
    if (!path) {
      return null
    }
    
    const content = await readTextFile(path)
    const filename = path.split(/[\\/]/).pop() || 'chat.json'
    
    return { content, filename }
  } catch (error) {
    console.error('选择文件失败:', error)
    return null
  }
}

/**
 * 预览聊天文件内容 (用于导入前预览)
 */
export function previewChatFile(content: string): {
  format: 'st_jsonl' | 'json' | 'unknown'
  messageCount: number
  characterName?: string
  userName?: string
  firstMessages: Array<{ name: string; content: string; role: string }>
  error?: string
} {
  const format = detectChatFormat(content)
  
  if (format === 'unknown') {
    return { format, messageCount: 0, firstMessages: [], error: '无法识别的文件格式' }
  }
  
  try {
    if (format === 'st_jsonl') {
      const lines = content.trim().split('\n').filter(line => line.trim())
      const metadata: STChatMetadata = JSON.parse(lines[0])
      const messages = lines.slice(1, 6).map(line => {
        const msg: STMessage = JSON.parse(line)
        return {
          name: msg.name,
          content: msg.mes.slice(0, 200),
          role: msg.is_user ? 'user' : msg.is_system ? 'system' : 'assistant'
        }
      })
      return {
        format,
        messageCount: lines.length - 1,
        characterName: metadata.character_name,
        userName: metadata.user_name,
        firstMessages: messages,
      }
    } else {
      const data: ChatExportData = JSON.parse(content)
      const messages = data.messages.slice(0, 5).map(msg => ({
        name: msg.name,
        content: msg.content.slice(0, 200),
        role: msg.role,
      }))
      return {
        format,
        messageCount: data.messages.length,
        characterName: data.chat.cardName,
        firstMessages: messages,
      }
    }
  } catch (error) {
    return {
      format,
      messageCount: 0,
      firstMessages: [],
      error: error instanceof Error ? error.message : '解析失败',
    }
  }
}
