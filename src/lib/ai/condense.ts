import { fetchAi } from './chat'
import { Chat } from '@/db/chats'
import { estimateTokens } from './token-counter'
import useSettingStore from '@/stores/setting'

const CONDENSE_THRESHOLD = 3 // AI 消息超过 3 条（不包括最新的 2 条）时检查压缩
const MIN_TOKEN_TO_CONDENSE = 100 // 单条消息超过 100 token 才压缩
const KEEP_LATEST_COUNT = 2 // 保留最新的 N 条 AI 消息不压缩

// 压缩提示词
const CONDENSE_PROMPT = `
请将以下对话内容压缩为简洁的摘要，用于节省 token 使用量。

压缩原则：
1. 保留代码块、数据、结论、TODO 等关键信息
2. 简化过程描述和中间思考
3. 使用清晰的段落或要点组织内容
4. 控制在 100 字以内

原始内容：
{content}

请输出摘要：
`

/**
 * 获取可压缩的 AI 消息（排除用户消息和已压缩的）
 * 规则：
 * - 用户消息永不压缩
 * - 最新的 N 条 AI 消息不压缩
 * - 已有摘要的消息不重复压缩
 */
function getCondensableChats(chats: Chat[]): Chat[] {
  // 只处理 AI (system) 的 chat 和 note 类型消息
  const aiMessages = chats.filter(c =>
    (c.type === 'chat' || c.type === 'note') &&
    c.role === 'system'
  )

  // 排除最新的 N 条
  const toCheck = aiMessages.slice(0, -KEEP_LATEST_COUNT)

  // 只返回没有摘要的消息
  return toCheck.filter(c => !c.condensedContent)
}

/**
 * 检查是否需要压缩
 */
export async function shouldCondense(chatsAfterClear: Chat[]): Promise<boolean> {
  // 获取可压缩的 AI 消息
  const condensableChats = getCondensableChats(chatsAfterClear)

  console.log('[Condense] 检查是否需要压缩:', {
    总消息数: chatsAfterClear.length,
    可压缩的AI消息: condensableChats.length,
    threshold: CONDENSE_THRESHOLD
  })

  if (condensableChats.length < CONDENSE_THRESHOLD) {
    console.log('[Condense] 不满足压缩条件: 可压缩的 AI 消息数量不足')
    return false
  }

  // 检查这些消息中是否有需要压缩的（超过 token 阈值）
  const needsCondense = condensableChats.some(chat =>
    estimateTokens(chat.content || '') > MIN_TOKEN_TO_CONDENSE
  )

  console.log('[Condense] Token 检查:', {
    需要压缩的消息数: condensableChats.filter(c => estimateTokens(c.content || '') > MIN_TOKEN_TO_CONDENSE).length,
    needsCondense
  })

  return needsCondense
}

/**
 * 为多条消息生成摘要
 * @returns 每条消息的摘要结果数组
 */
export async function condenseChats(chatsAfterClear: Chat[]): Promise<Array<{ chatId: number, summary: string | null }>> {
  console.log('[Condense] 开始为消息生成摘要...')

  // 获取需要压缩的消息
  const toCondense = getCondensableChats(chatsAfterClear)

  console.log('[Condense] 将为以下 AI 消息生成摘要:', {
    总消息数: chatsAfterClear.length,
    将摘要: toCondense.length,
    消息ID: toCondense.map(c => c.id)
  })

  if (toCondense.length === 0) {
    console.log('[Condense] 没有需要生成摘要的消息')
    return []
  }

  // 获取用户配置的摘要模型
  const { condenseModel, primaryModel } = useSettingStore.getState()
  const hasCondenseModel = !!condenseModel

  console.log('[Condense] 使用摘要模型:', {
    hasCondenseModel,
    配置的模型: condenseModel || '未配置',
    primaryModel
  })

  // 如果配置了 condenseModel，使用 'condenseModel' store key，否则使用 'primaryModel'
  const storeKey = hasCondenseModel ? 'condenseModel' : 'primaryModel'

  const results: Array<{ chatId: number, summary: string | null }> = []

  // 为每条消息生成摘要
  for (const chat of toCondense) {
    const content = chat.content || ''
    const originalTokenCount = estimateTokens(content)

    // 只压缩超过阈值的消息
    if (originalTokenCount <= MIN_TOKEN_TO_CONDENSE) {
      console.log('[Condense] 消息', chat.id, 'token 数不足，跳过')
      results.push({ chatId: chat.id, summary: null })
      continue
    }

    try {
      const prompt = CONDENSE_PROMPT.replace('{content}', content)
      console.log('[Condense] 为消息', chat.id, '生成摘要，原始 token 数:', originalTokenCount, 'store key:', storeKey)

      const summary = await fetchAi(prompt, storeKey)

      if (summary) {
        console.log('[Condense] 消息', chat.id, '摘要生成成功，摘要长度:', summary.length, '字符')
        results.push({ chatId: chat.id, summary })
      } else {
        console.log('[Condense] 消息', chat.id, '摘要生成失败：AI 返回空结果')
        results.push({ chatId: chat.id, summary: null })
      }
    } catch (error) {
      console.error('[Condense] 消息', chat.id, '摘要生成出错:', error)
      results.push({ chatId: chat.id, summary: null })
    }
  }

  console.log('[Condense] 所有摘要生成完成，成功:', results.filter(r => r.summary).length, '/', results.length)
  return results
}

/**
 * 获取最后一次清除后的消息
 */
export function getChatsAfterLastClear(chats: Chat[]): Chat[] {
  const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
  return lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)
}

/**
 * 构建用于 AI 的消息历史
 * 规则：
 * 1. 用户消息：始终使用原文（永不使用摘要）
 * 2. AI 消息：如果有 condensedContent，使用摘要；否则使用原文
 *
 * @param chats 原始聊天记录数组
 * @returns 用于 AI 的消息历史字符串
 */
export function buildChatHistoryForAI(chats: Chat[]): string {
  // 获取最后一次清除后的消息
  const chatsAfterClear = getChatsAfterLastClear(chats)

  console.log('[buildChatHistoryForAI] 开始构建 AI 消息历史，总消息数:', chatsAfterClear.length)

  // 构建消息历史
  const historyParts: string[] = []

  // 计算原始内容（假设全部使用原文）
  let originalTotalLength = 0
  // 计算实际内容（使用摘要替代部分消息）
  let actualTotalLength = 0

  for (const chat of chatsAfterClear) {
    // 只包含 chat 和 note 类型的消息
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    const roleLabel = chat.role === 'user' ? '用户' : 'AI'
    let content: string
    let hasCondensed = false
    let originalLength = 0
    let condensedLength = 0

    if (chat.role === 'user') {
      // 用户消息：始终使用原文
      content = chat.content || ''
      originalLength = content.length
      condensedLength = 0
      hasCondensed = false
    } else {
      // AI 消息：使用摘要（如果有），否则使用原文
      hasCondensed = !!chat.condensedContent
      content = chat.condensedContent || chat.content || ''
      originalLength = (chat.content || '').length
      condensedLength = (chat.condensedContent || '').length
    }

    // 累计原始长度
    originalTotalLength += originalLength
    // 累计实际长度
    actualTotalLength += content.length

    const part = `${roleLabel}: ${content}`
    historyParts.push(part)

    console.log('[buildChatHistoryForAI] 消息', chat.id, ':', {
      角色: roleLabel,
      使用摘要: hasCondensed,
      原文长度: originalLength,
      摘要长度: condensedLength,
      压缩率: hasCondensed && originalLength > 0 ? Math.round((1 - condensedLength / originalLength) * 100) + '%' : 'N/A'
    })
  }

  const result = historyParts.join('\n\n---\n\n')

  // 计算节省的内容
  const savedLength = originalTotalLength - actualTotalLength
  const savedPercentage = originalTotalLength > 0 ? Math.round((savedLength / originalTotalLength) * 100) : 0

  console.log('[buildChatHistoryForAI] 最终输出:', {
    消息条数: historyParts.length,
    原始总字符数: originalTotalLength,
    实际总字符数: actualTotalLength,
    节省字符数: savedLength,
    节省比例: savedPercentage + '%',
    内容预览: result.substring(0, 200) + (result.length > 200 ? '...' : '')
  })

  return result
}
