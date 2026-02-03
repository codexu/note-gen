'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Hash, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { estimateTokens } from '@/lib/tavern'
import type { TokenBreakdown } from '@/lib/tavern/context-builder-v2'

interface TokenCounterProps {
  // 当前上下文的消息
  messages?: Array<{ content: string }>
  // 当前输入框内容
  inputValue?: string
  // 最大上下文长度
  maxTokens?: number
  // 为响应预留的 Token
  reserveTokens?: number
  // 是否紧凑模式
  compact?: boolean
  // 自定义类名
  className?: string
  // Token 分类统计
  breakdown?: TokenBreakdown
  // 是否显示分类详情
  showBreakdown?: boolean
}

export function TokenCounter({
  messages = [],
  inputValue = '',
  maxTokens = 4096,
  reserveTokens = 1024,
  compact = false,
  className,
  breakdown,
  showBreakdown = false,
}: TokenCounterProps) {
  // 计算当前使用的 Token 数
  const { contextTokens, inputTokens, totalTokens, availableTokens, percentage, isWarning, isDanger } = useMemo(() => {
    // 上下文消息的 Token
    const contextTokens = messages.reduce(
      (sum, msg) => sum + estimateTokens(msg.content),
      0
    )
    
    // 输入框的 Token
    const inputTokens = estimateTokens(inputValue)
    
    // 总计
    const totalTokens = contextTokens + inputTokens
    
    // 可用预算 (减去预留)
    const budget = maxTokens - reserveTokens
    const availableTokens = Math.max(0, budget - totalTokens)
    
    // 百分比
    const percentage = Math.min(100, (totalTokens / budget) * 100)
    
    // 警告阈值
    const isWarning = percentage >= 70 && percentage < 90
    const isDanger = percentage >= 90
    
    return {
      contextTokens,
      inputTokens,
      totalTokens,
      availableTokens,
      percentage,
      isWarning,
      isDanger,
    }
  }, [messages, inputValue, maxTokens, reserveTokens])

  // 紧凑模式
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={isDanger ? 'destructive' : isWarning ? 'secondary' : 'outline'}
              className={cn(
                'gap-1 cursor-help',
                isDanger && 'animate-pulse',
                className
              )}
            >
              <Hash className="h-3 w-3" />
              <span className="tabular-nums">{totalTokens}</span>
              {isDanger && <AlertTriangle className="h-3 w-3" />}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-64">
            <TokenDetails
              contextTokens={contextTokens}
              inputTokens={inputTokens}
              totalTokens={totalTokens}
              availableTokens={availableTokens}
              maxTokens={maxTokens}
              reserveTokens={reserveTokens}
              percentage={percentage}
            />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Token 使用</span>
        <span
          className={cn(
            'font-mono',
            isDanger && 'text-destructive font-bold',
            isWarning && 'text-amber-500'
          )}
        >
          {totalTokens} / {maxTokens - reserveTokens}
        </span>
      </div>
      <Progress
        value={percentage}
        className={cn(
          'h-2',
          isDanger && '[&>div]:bg-destructive',
          isWarning && '[&>div]:bg-amber-500'
        )}
      />
      <TokenDetails
        contextTokens={contextTokens}
        inputTokens={inputTokens}
        totalTokens={totalTokens}
        availableTokens={availableTokens}
        maxTokens={maxTokens}
        reserveTokens={reserveTokens}
        percentage={percentage}
        showProgress={false}
      />
      {showBreakdown && breakdown && (
        <TokenBreakdownPanel breakdown={breakdown} maxTokens={maxTokens - reserveTokens} />
      )}
    </div>
  )
}

interface TokenDetailsProps {
  contextTokens: number
  inputTokens: number
  totalTokens: number
  availableTokens: number
  maxTokens: number
  reserveTokens: number
  percentage: number
  showProgress?: boolean
}

function TokenDetails({
  contextTokens,
  inputTokens,
  totalTokens,
  availableTokens,
  maxTokens,
  reserveTokens,
  percentage,
  showProgress = true,
}: TokenDetailsProps) {
  return (
    <div className="space-y-2 text-xs">
      {showProgress && (
        <Progress value={percentage} className="h-1.5" />
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">上下文:</span>
        <span className="text-right font-mono">{contextTokens}</span>
        
        <span className="text-muted-foreground">当前输入:</span>
        <span className="text-right font-mono">{inputTokens}</span>
        
        <span className="text-muted-foreground">已使用:</span>
        <span className="text-right font-mono font-medium">{totalTokens}</span>
        
        <span className="text-muted-foreground">剩余可用:</span>
        <span className={cn(
          'text-right font-mono',
          availableTokens < 200 && 'text-destructive'
        )}>
          {availableTokens}
        </span>
      </div>
      <div className="pt-1 border-t text-muted-foreground">
        <div className="flex justify-between">
          <span>最大上下文:</span>
          <span className="font-mono">{maxTokens}</span>
        </div>
        <div className="flex justify-between">
          <span>响应预留:</span>
          <span className="font-mono">{reserveTokens}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Token 分类显示面板
 */
interface TokenBreakdownPanelProps {
  breakdown: TokenBreakdown
  maxTokens: number
}

function TokenBreakdownPanel({ breakdown, maxTokens }: TokenBreakdownPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  // 分类配置
  const categories = [
    { key: 'systemPrompt', label: '系统提示词', color: 'bg-blue-500' },
    { key: 'charDescription', label: '角色描述', color: 'bg-purple-500' },
    { key: 'charPersonality', label: '角色性格', color: 'bg-violet-500' },
    { key: 'scenario', label: '场景', color: 'bg-indigo-500' },
    { key: 'personaDescription', label: '用户人设', color: 'bg-cyan-500' },
    { key: 'worldInfoBefore', label: '世界书 (Before)', color: 'bg-emerald-500' },
    { key: 'worldInfoAfter', label: '世界书 (After)', color: 'bg-green-500' },
    { key: 'exampleDialogue', label: '示例对话', color: 'bg-amber-500' },
    { key: 'chatHistory', label: '聊天历史', color: 'bg-orange-500' },
    { key: 'authorsNote', label: '作者注释', color: 'bg-rose-500' },
    { key: 'depthInjections', label: '深度注入', color: 'bg-pink-500' },
    { key: 'extensions', label: '扩展插件', color: 'bg-slate-500' },
  ] as const
  
  // 过滤掉值为 0 的分类
  const activeCategories = categories.filter(
    cat => breakdown[cat.key as keyof TokenBreakdown] > 0
  )
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Token 分类统计</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {/* 堆叠条形图 */}
        <div className="h-3 rounded-full overflow-hidden flex bg-muted mb-2">
          {activeCategories.map(cat => {
            const value = breakdown[cat.key as keyof TokenBreakdown]
            const percent = (value / maxTokens) * 100
            if (percent < 0.5) return null
            return (
              <TooltipProvider key={cat.key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className={cn('h-full', cat.color)}
                      style={{ width: `${percent}%` }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div className="font-medium">{cat.label}</div>
                      <div className="text-muted-foreground">
                        {value} tokens ({percent.toFixed(1)}%)
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
        
        {/* 详细列表 */}
        <div className="space-y-1">
          {activeCategories.map(cat => {
            const value = breakdown[cat.key as keyof TokenBreakdown]
            const percent = (value / maxTokens) * 100
            return (
              <div key={cat.key} className="flex items-center gap-2 text-xs">
                <div className={cn('w-2 h-2 rounded-full', cat.color)} />
                <span className="flex-1 text-muted-foreground">{cat.label}</span>
                <span className="font-mono tabular-nums">{value}</span>
                <span className="text-muted-foreground w-12 text-right">
                  {percent.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * 实时 Token 计数 Hook
 */
export function useTokenCount(
  messages: Array<{ content: string }>,
  inputValue: string,
  maxTokens: number = 4096,
  reserveTokens: number = 1024
) {
  return useMemo(() => {
    const contextTokens = messages.reduce(
      (sum, msg) => sum + estimateTokens(msg.content),
      0
    )
    const inputTokens = estimateTokens(inputValue)
    const totalTokens = contextTokens + inputTokens
    const budget = maxTokens - reserveTokens
    const availableTokens = Math.max(0, budget - totalTokens)
    const percentage = Math.min(100, (totalTokens / budget) * 100)
    
    return {
      contextTokens,
      inputTokens,
      totalTokens,
      availableTokens,
      percentage,
      isWarning: percentage >= 70 && percentage < 90,
      isDanger: percentage >= 90,
    }
  }, [messages, inputValue, maxTokens, reserveTokens])
}

/**
 * Token 分类统计 Hook
 */
export function useTokenBreakdown(breakdown?: TokenBreakdown) {
  return useMemo(() => {
    if (!breakdown) return null
    
    // 计算各类占比
    const total = breakdown.total || 1
    return {
      ...breakdown,
      percentages: {
        systemPrompt: (breakdown.systemPrompt / total) * 100,
        charDescription: (breakdown.charDescription / total) * 100,
        charPersonality: (breakdown.charPersonality / total) * 100,
        scenario: (breakdown.scenario / total) * 100,
        personaDescription: (breakdown.personaDescription / total) * 100,
        worldInfoBefore: (breakdown.worldInfoBefore / total) * 100,
        worldInfoAfter: (breakdown.worldInfoAfter / total) * 100,
        exampleDialogue: (breakdown.exampleDialogue / total) * 100,
        chatHistory: (breakdown.chatHistory / total) * 100,
        authorsNote: (breakdown.authorsNote / total) * 100,
        depthInjections: (breakdown.depthInjections / total) * 100,
        extensions: (breakdown.extensions / total) * 100,
      },
    }
  }, [breakdown])
}

export default TokenCounter
