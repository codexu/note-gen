/**
 * 表情检测服务
 * 根据文本内容检测情绪并匹配表情
 */

import {
  useTavernExpressionsStore,
  Expression,
  ExpressionType,
  DEFAULT_EXPRESSION_TYPES,
} from '@/stores/tavern-expressions'

// 检测结果
export interface ExpressionDetectionResult {
  expressionId: string | null
  expressionType: ExpressionType | null
  confidence: number  // 0-1
  matchedKeywords: string[]
}

// 从文本检测表情 (关键词匹配)
export function detectExpressionByKeywords(
  text: string,
  expressions: Expression[],
  caseSensitive: boolean = false
): ExpressionDetectionResult {
  const searchText = caseSensitive ? text : text.toLowerCase()
  
  let bestMatch: Expression | null = null
  let bestScore = 0
  let matchedKeywords: string[] = []
  
  for (const expression of expressions) {
    let score = 0
    const matched: string[] = []
    
    for (const keyword of expression.keywords) {
      const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase()
      
      if (searchText.includes(searchKeyword)) {
        score += keyword.length * expression.priority
        matched.push(keyword)
      }
    }
    
    if (score > bestScore) {
      bestScore = score
      bestMatch = expression
      matchedKeywords = matched
    }
  }
  
  return {
    expressionId: bestMatch?.id || null,
    expressionType: bestMatch?.type || null,
    confidence: bestMatch ? Math.min(1, bestScore / 100) : 0,
    matchedKeywords,
  }
}

// 使用 AI 检测情绪
export async function detectExpressionByAI(
  text: string,
  prompt: string,
  expressions: Expression[]
): Promise<ExpressionDetectionResult> {
  try {
    const { streamTavernResponse, checkAIServiceAvailable } = await import('./ai-service')
    
    const isAvailable = await checkAIServiceAvailable()
    if (!isAvailable) {
      return {
        expressionId: null,
        expressionType: null,
        confidence: 0,
        matchedKeywords: [],
      }
    }
    
    // 构建消息
    const messages = [
      {
        role: 'system' as const,
        content: prompt,
      },
      {
        role: 'user' as const,
        content: text,
      },
    ]
    
    let result = ''
    
    await streamTavernResponse(
      messages,
      (content: string) => {
        result = content
      },
      undefined,
      { temperature: 0.1, maxTokens: 50 }
    )
    
    // 解析结果
    const detectedType = result.trim().toLowerCase() as ExpressionType
    const matchedExpression = expressions.find(exp => exp.type === detectedType)
    
    return {
      expressionId: matchedExpression?.id || null,
      expressionType: detectedType,
      confidence: matchedExpression ? 0.8 : 0.5,
      matchedKeywords: [],
    }
  } catch (error) {
    console.error('AI 表情检测失败:', error)
    return {
      expressionId: null,
      expressionType: null,
      confidence: 0,
      matchedKeywords: [],
    }
  }
}

// 综合检测表情
export async function detectExpression(
  text: string,
  cardId: number
): Promise<ExpressionDetectionResult> {
  const { config, getCharacterExpressions } = useTavernExpressionsStore.getState()
  
  if (!config.enabled) {
    return {
      expressionId: null,
      expressionType: null,
      confidence: 0,
      matchedKeywords: [],
    }
  }
  
  const charExpressions = getCharacterExpressions(cardId)
  if (!charExpressions || !charExpressions.enabled || charExpressions.expressions.length === 0) {
    return {
      expressionId: null,
      expressionType: null,
      confidence: 0,
      matchedKeywords: [],
    }
  }
  
  // 优先使用关键词检测
  if (config.useKeywordDetection) {
    const keywordResult = detectExpressionByKeywords(
      text,
      charExpressions.expressions,
      config.caseSensitive
    )
    
    if (keywordResult.expressionId) {
      return keywordResult
    }
  }
  
  // 如果关键词没有匹配，尝试 AI 检测
  if (config.useAIDetection) {
    const aiResult = await detectExpressionByAI(
      text,
      config.aiDetectionPrompt,
      charExpressions.expressions
    )
    
    if (aiResult.expressionId) {
      return aiResult
    }
  }
  
  // 返回默认表情
  const defaultExpression = charExpressions.expressions.find(
    exp => exp.id === charExpressions.defaultExpression
  )
  
  return {
    expressionId: defaultExpression?.id || null,
    expressionType: defaultExpression?.type || null,
    confidence: 0,
    matchedKeywords: [],
  }
}

// 更新当前表情
export async function updateCurrentExpression(
  text: string,
  cardId: number
): Promise<void> {
  const { setCurrentExpression } = useTavernExpressionsStore.getState()
  
  const result = await detectExpression(text, cardId)
  
  if (result.expressionId) {
    setCurrentExpression(cardId, result.expressionId)
  }
}

// 创建默认表情配置
export function createDefaultExpressions(cardId: number): Expression[] {
  return DEFAULT_EXPRESSION_TYPES.map((def, index) => ({
    id: `${cardId}-${def.type}`,
    type: def.type,
    name: def.name,
    imagePath: '',
    keywords: def.keywords,
    priority: 10 - index,
  }))
}

// 获取表情图片尺寸样式
export function getExpressionSizeStyle(size: 'small' | 'medium' | 'large' | 'full'): {
  width: string
  height: string
} {
  switch (size) {
    case 'small':
      return { width: '150px', height: '150px' }
    case 'medium':
      return { width: '250px', height: '250px' }
    case 'large':
      return { width: '400px', height: '400px' }
    case 'full':
      return { width: '100%', height: '100%' }
  }
}

// 获取表情位置样式
export function getExpressionPositionStyle(position: 'left' | 'right' | 'background'): React.CSSProperties {
  switch (position) {
    case 'left':
      return {
        position: 'absolute',
        left: '1rem',
        bottom: '1rem',
        zIndex: 10,
      }
    case 'right':
      return {
        position: 'absolute',
        right: '1rem',
        bottom: '1rem',
        zIndex: 10,
      }
    case 'background':
      return {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        objectFit: 'cover',
      }
  }
}
