import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 表情类型
export type ExpressionType = 
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'confused'
  | 'thinking'
  | 'embarrassed'
  | 'love'
  | 'fear'
  | 'disgust'
  | 'custom'

// 表情定义
export interface Expression {
  id: string
  type: ExpressionType
  name: string
  imagePath: string        // 图片路径
  keywords: string[]       // 触发关键词
  priority: number         // 优先级 (数字越大优先级越高)
}

// 角色表情配置
export interface CharacterExpressions {
  cardId: number
  enabled: boolean
  defaultExpression: string  // 默认表情 ID
  expressions: Expression[]
  
  // 显示设置
  position: 'left' | 'right' | 'background'
  size: 'small' | 'medium' | 'large' | 'full'
  opacity: number           // 0-100
  
  // 动画设置
  fadeTransition: boolean
  transitionDuration: number  // ms
}

// 全局表情配置
export interface ExpressionsConfig {
  enabled: boolean
  
  // AI 检测设置
  useAIDetection: boolean    // 使用 AI 检测情绪
  aiDetectionPrompt: string  // AI 检测提示词
  
  // 关键词检测设置
  useKeywordDetection: boolean
  caseSensitive: boolean
  
  // 显示设置
  showExpressionName: boolean
  defaultPosition: 'left' | 'right' | 'background'
  defaultSize: 'small' | 'medium' | 'large' | 'full'
  defaultOpacity: number
  
  // 动画设置
  fadeTransition: boolean
  transitionDuration: number
}

interface TavernExpressionsState {
  // 全局配置
  config: ExpressionsConfig
  
  // 角色表情配置 (cardId -> config)
  characterExpressions: Record<number, CharacterExpressions>
  
  // 当前显示的表情 (cardId -> expressionId)
  currentExpressions: Record<number, string>
  
  // 获取有效配置
  getEffectiveConfig: () => ExpressionsConfig
  
  // 更新全局配置
  updateConfig: (updates: Partial<ExpressionsConfig>) => void
  
  // 角色表情管理
  getCharacterExpressions: (cardId: number) => CharacterExpressions | null
  setCharacterExpressions: (cardId: number, config: CharacterExpressions) => void
  updateCharacterExpressions: (cardId: number, updates: Partial<CharacterExpressions>) => void
  deleteCharacterExpressions: (cardId: number) => void
  
  // 表情管理
  addExpression: (cardId: number, expression: Expression) => void
  updateExpression: (cardId: number, expressionId: string, updates: Partial<Expression>) => void
  deleteExpression: (cardId: number, expressionId: string) => void
  
  // 当前表情
  setCurrentExpression: (cardId: number, expressionId: string) => void
  getCurrentExpression: (cardId: number) => Expression | null
  clearCurrentExpression: (cardId: number) => void
}

// 默认表情列表
export const DEFAULT_EXPRESSION_TYPES: { type: ExpressionType; name: string; keywords: string[] }[] = [
  { type: 'neutral', name: '平静', keywords: ['好的', '嗯', '是的', '明白'] },
  { type: 'happy', name: '开心', keywords: ['哈哈', '太好了', '开心', '高兴', '棒', '喜欢', '爱', '❤', '😊', '😄'] },
  { type: 'sad', name: '难过', keywords: ['难过', '伤心', '哭', '呜呜', '😢', '😭', '抱歉', '对不起'] },
  { type: 'angry', name: '生气', keywords: ['生气', '愤怒', '可恶', '讨厌', '😠', '😡', '烦'] },
  { type: 'surprised', name: '惊讶', keywords: ['惊讶', '什么', '真的吗', '不会吧', '😮', '😲', '！'] },
  { type: 'confused', name: '困惑', keywords: ['困惑', '不懂', '为什么', '怎么', '？', '🤔'] },
  { type: 'thinking', name: '思考', keywords: ['思考', '让我想想', '嗯...', '这个...', '🤔'] },
  { type: 'embarrassed', name: '害羞', keywords: ['害羞', '不好意思', '脸红', '😳', '///'] },
  { type: 'love', name: '喜爱', keywords: ['喜欢你', '爱你', '❤', '💕', '💗', '亲爱的'] },
  { type: 'fear', name: '害怕', keywords: ['害怕', '可怕', '恐怖', '😨', '😱'] },
  { type: 'disgust', name: '厌恶', keywords: ['恶心', '讨厌', '呕', '🤢'] },
]

// 默认配置
const DEFAULT_CONFIG: ExpressionsConfig = {
  enabled: true,
  useAIDetection: false,
  aiDetectionPrompt: '分析以下文本的情绪，返回一个情绪类型：neutral, happy, sad, angry, surprised, confused, thinking, embarrassed, love, fear, disgust',
  useKeywordDetection: true,
  caseSensitive: false,
  showExpressionName: false,
  defaultPosition: 'right',
  defaultSize: 'medium',
  defaultOpacity: 100,
  fadeTransition: true,
  transitionDuration: 300,
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useTavernExpressionsStore = create<TavernExpressionsState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      characterExpressions: {},
      currentExpressions: {},
      
      getEffectiveConfig: () => {
        return get().config
      },
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      getCharacterExpressions: (cardId) => {
        return get().characterExpressions[cardId] || null
      },
      
      setCharacterExpressions: (cardId, config) => {
        set((state) => ({
          characterExpressions: {
            ...state.characterExpressions,
            [cardId]: config,
          },
        }))
      },
      
      updateCharacterExpressions: (cardId, updates) => {
        set((state) => {
          const existing = state.characterExpressions[cardId]
          if (!existing) return state
          
          return {
            characterExpressions: {
              ...state.characterExpressions,
              [cardId]: { ...existing, ...updates },
            },
          }
        })
      },
      
      deleteCharacterExpressions: (cardId) => {
        set((state) => {
          const newExpressions = { ...state.characterExpressions }
          delete newExpressions[cardId]
          return { characterExpressions: newExpressions }
        })
      },
      
      addExpression: (cardId, expression) => {
        set((state) => {
          const existing = state.characterExpressions[cardId]
          if (!existing) return state
          
          return {
            characterExpressions: {
              ...state.characterExpressions,
              [cardId]: {
                ...existing,
                expressions: [...existing.expressions, { ...expression, id: expression.id || generateId() }],
              },
            },
          }
        })
      },
      
      updateExpression: (cardId, expressionId, updates) => {
        set((state) => {
          const existing = state.characterExpressions[cardId]
          if (!existing) return state
          
          return {
            characterExpressions: {
              ...state.characterExpressions,
              [cardId]: {
                ...existing,
                expressions: existing.expressions.map(exp =>
                  exp.id === expressionId ? { ...exp, ...updates } : exp
                ),
              },
            },
          }
        })
      },
      
      deleteExpression: (cardId, expressionId) => {
        set((state) => {
          const existing = state.characterExpressions[cardId]
          if (!existing) return state
          
          return {
            characterExpressions: {
              ...state.characterExpressions,
              [cardId]: {
                ...existing,
                expressions: existing.expressions.filter(exp => exp.id !== expressionId),
              },
            },
          }
        })
      },
      
      setCurrentExpression: (cardId, expressionId) => {
        set((state) => ({
          currentExpressions: {
            ...state.currentExpressions,
            [cardId]: expressionId,
          },
        }))
      },
      
      getCurrentExpression: (cardId) => {
        const { characterExpressions, currentExpressions } = get()
        const charConfig = characterExpressions[cardId]
        if (!charConfig) return null
        
        const currentId = currentExpressions[cardId] || charConfig.defaultExpression
        return charConfig.expressions.find(exp => exp.id === currentId) || null
      },
      
      clearCurrentExpression: (cardId) => {
        set((state) => {
          const newCurrent = { ...state.currentExpressions }
          delete newCurrent[cardId]
          return { currentExpressions: newCurrent }
        })
      },
    }),
    {
      name: 'tavern-expressions',
      partialize: (state) => ({
        config: state.config,
        characterExpressions: state.characterExpressions,
      }),
    }
  )
)
