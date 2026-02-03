'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTavernMemoryStore, MemorySummary } from '@/stores/tavern-memory'
import { TavernMessage } from '@/db/tavern'
import { generateSummary, estimateTokens } from '@/lib/tavern/memory-service'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  Brain,
  Plus,
  Trash2,
  Pencil,
  Settings2,
  ChevronDown,
  HelpCircle,
  Sparkles,
  FileText,
  Clock,
  Loader2,
} from 'lucide-react'

interface MemoryPanelProps {
  cardId?: number
  chatId?: number
  messages?: TavernMessage[]
  compact?: boolean
  className?: string
}

export function MemoryPanel({
  cardId,
  chatId,
  messages = [],
  compact = false,
  className,
}: MemoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'summaries' | 'settings'>('summaries')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingContent, setGeneratingContent] = useState('')
  const [editingSummary, setEditingSummary] = useState<MemorySummary | null>(null)
  const [editContent, setEditContent] = useState('')

  const {
    config,
    getEffectiveConfig,
    getChatMemory,
    updateConfig,
    addSummary,
    updateSummary,
    deleteSummary,
    clearChatMemory,
  } = useTavernMemoryStore()

  const effectiveConfig = getEffectiveConfig(cardId)
  const chatMemory = chatId ? getChatMemory(chatId) : null

  // 手动生成摘要
  const handleGenerateSummary = useCallback(async () => {
    if (!chatId || messages.length === 0 || isGenerating) return

    setIsGenerating(true)
    setGeneratingContent('')

    try {
      const memory = getChatMemory(chatId)
      const startIndex = memory.lastSummarizedIndex + 1
      const endIndex = messages.length - 1 - effectiveConfig.preserveLastN

      if (endIndex <= startIndex) {
        alert('没有足够的消息需要摘要')
        return
      }

      const result = await generateSummary(
        messages,
        effectiveConfig,
        startIndex,
        endIndex,
        { onProgress: (content) => setGeneratingContent(content) }
      )

      if (result.success && result.summary) {
        addSummary(chatId, {
          content: result.summary,
          messageRange: { start: startIndex, end: endIndex },
          tokenCount: result.tokenCount || 0,
          isManual: false,
        })
      } else {
        alert(result.error || '摘要生成失败')
      }
    } catch (error) {
      console.error('生成摘要失败:', error)
      alert('生成摘要失败')
    } finally {
      setIsGenerating(false)
      setGeneratingContent('')
    }
  }, [chatId, messages, isGenerating, effectiveConfig, getChatMemory, addSummary])

  // 开始编辑摘要
  const handleStartEdit = useCallback((summary: MemorySummary) => {
    setEditingSummary(summary)
    setEditContent(summary.content)
  }, [])

  // 保存编辑
  const handleSaveEdit = useCallback(() => {
    if (!chatId || !editingSummary) return
    updateSummary(chatId, editingSummary.id, editContent)
    setEditingSummary(null)
    setEditContent('')
  }, [chatId, editingSummary, editContent, updateSummary])

  // 删除摘要
  const handleDeleteSummary = useCallback((summaryId: string) => {
    if (!chatId) return
    if (confirm('确定要删除这条摘要吗？')) {
      deleteSummary(chatId, summaryId)
    }
  }, [chatId, deleteSummary])

  // 清除所有记忆
  const handleClearMemory = useCallback(() => {
    if (!chatId) return
    if (confirm('确定要清除所有记忆吗？这将删除所有摘要。')) {
      clearChatMemory(chatId)
    }
  }, [chatId, clearChatMemory])

  // 计算统计信息
  const summaryCount = chatMemory?.summaries.length || 0
  const totalTokensSaved = chatMemory?.totalTokensSaved || 0

  // 紧凑模式
  if (compact) {
    return (
      <>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1 text-xs',
                    effectiveConfig.enabled && 'text-violet-600',
                    className
                  )}
                >
                  <Brain className="h-4 w-4" />
                  {summaryCount > 0 && (
                    <span className="hidden sm:inline">{summaryCount}</span>
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>记忆/摘要 ({summaryCount} 条)</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-[420px] p-0" align="end">
            <MemoryContent
              config={effectiveConfig}
              chatMemory={chatMemory}
              messages={messages}
              isGenerating={isGenerating}
              generatingContent={generatingContent}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onUpdateConfig={updateConfig}
              onGenerateSummary={handleGenerateSummary}
              onEditSummary={handleStartEdit}
              onDeleteSummary={handleDeleteSummary}
              onClearMemory={handleClearMemory}
              chatId={chatId}
            />
          </PopoverContent>
        </Popover>

        {/* 编辑对话框 */}
        <Dialog open={!!editingSummary} onOpenChange={(open) => !open && setEditingSummary(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑摘要</DialogTitle>
              <DialogDescription>
                消息范围: {editingSummary?.messageRange.start} - {editingSummary?.messageRange.end}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[200px]"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingSummary(null)}>
                取消
              </Button>
              <Button onClick={handleSaveEdit}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <MemoryContent
        config={effectiveConfig}
        chatMemory={chatMemory}
        messages={messages}
        isGenerating={isGenerating}
        generatingContent={generatingContent}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onUpdateConfig={updateConfig}
        onGenerateSummary={handleGenerateSummary}
        onEditSummary={handleStartEdit}
        onDeleteSummary={handleDeleteSummary}
        onClearMemory={handleClearMemory}
        chatId={chatId}
        expanded
      />
    </div>
  )
}


// 内容组件
interface MemoryContentProps {
  config: ReturnType<typeof useTavernMemoryStore.getState>['config']
  chatMemory: ReturnType<ReturnType<typeof useTavernMemoryStore.getState>['getChatMemory']> | null
  messages: TavernMessage[]
  isGenerating: boolean
  generatingContent: string
  activeTab: 'summaries' | 'settings'
  setActiveTab: (tab: 'summaries' | 'settings') => void
  onUpdateConfig: (updates: Partial<ReturnType<typeof useTavernMemoryStore.getState>['config']>) => void
  onGenerateSummary: () => void
  onEditSummary: (summary: MemorySummary) => void
  onDeleteSummary: (summaryId: string) => void
  onClearMemory: () => void
  chatId?: number
  expanded?: boolean
}

function MemoryContent({
  config,
  chatMemory,
  messages,
  isGenerating,
  generatingContent,
  activeTab,
  setActiveTab,
  onUpdateConfig,
  onGenerateSummary,
  onEditSummary,
  onDeleteSummary,
  onClearMemory,
  chatId,
  expanded = false,
}: MemoryContentProps) {
  const [showHelp, setShowHelp] = useState(false)

  // 计算当前 token 数
  const currentTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const unsummarizedCount = messages.length - (chatMemory?.lastSummarizedIndex || -1) - 1 - config.preserveLastN

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-600" />
          <span className="font-medium text-sm">记忆/摘要</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowHelp(!showHelp)}
              >
                <HelpCircle className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                自动或手动生成对话摘要，压缩历史消息以节省 token。
                摘要会被注入到上下文中保持连贯性。
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => onUpdateConfig({ enabled })}
          />
          <span className="text-xs text-muted-foreground">
            {config.enabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      {/* 帮助信息 */}
      {showHelp && (
        <div className="p-3 bg-muted/50 border-b text-xs space-y-1">
          <p><strong>工作原理:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li>当消息数或 token 数超过阈值时触发摘要</li>
            <li>AI 会生成对话摘要，保留关键信息</li>
            <li>摘要会替代原始消息注入上下文</li>
            <li>最近的消息会保留不被摘要</li>
          </ul>
        </div>
      )}

      {/* 统计信息 */}
      <div className="p-3 border-b bg-muted/30">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-semibold">{chatMemory?.summaries.length || 0}</div>
            <div className="text-xs text-muted-foreground">摘要数</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{chatMemory?.totalTokensSaved || 0}</div>
            <div className="text-xs text-muted-foreground">节省 tokens</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{currentTokens}</div>
            <div className="text-xs text-muted-foreground">当前 tokens</div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'summaries' | 'settings')} className="w-full">
        <TabsList className="w-full grid grid-cols-2 h-9 m-2 mb-0">
          <TabsTrigger value="summaries" className="text-xs gap-1">
            <FileText className="h-3 w-3" />
            摘要列表
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-xs gap-1">
            <Settings2 className="h-3 w-3" />
            设置
          </TabsTrigger>
        </TabsList>

        <ScrollArea className={cn('flex-1', expanded ? 'h-[350px]' : 'max-h-[300px]')}>
          {/* 摘要列表 */}
          <TabsContent value="summaries" className="p-3 space-y-3 mt-0">
            {/* 生成按钮 */}
            <div className="flex items-center gap-2">
              <Button
                onClick={onGenerateSummary}
                disabled={isGenerating || !chatId || messages.length === 0}
                size="sm"
                className="flex-1"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" />
                    生成摘要
                  </>
                )}
              </Button>
              {(chatMemory?.summaries.length || 0) > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearMemory}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* 待摘要提示 */}
            {unsummarizedCount > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                有 {unsummarizedCount} 条消息待摘要
                {unsummarizedCount >= config.triggerThreshold && (
                  <Badge variant="secondary" className="ml-2">建议摘要</Badge>
                )}
              </div>
            )}

            {/* 生成中预览 */}
            {isGenerating && generatingContent && (
              <div className="p-3 rounded-lg border bg-violet-50 dark:bg-violet-950/30">
                <div className="flex items-center gap-2 mb-2 text-xs text-violet-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在生成摘要...
                </div>
                <p className="text-sm whitespace-pre-wrap">{generatingContent}</p>
              </div>
            )}

            {/* 摘要列表 */}
            {chatMemory?.summaries.length === 0 && !isGenerating ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>暂无摘要</p>
                <p className="text-xs mt-1">点击上方按钮生成摘要</p>
              </div>
            ) : (
              <div className="space-y-2">
                {chatMemory?.summaries.map((summary) => (
                  <SummaryItem
                    key={summary.id}
                    summary={summary}
                    onEdit={() => onEditSummary(summary)}
                    onDelete={() => onDeleteSummary(summary.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* 设置 */}
          <TabsContent value="settings" className="p-3 space-y-4 mt-0">
            {/* 触发设置 */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">触发条件</Label>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">消息数阈值</Label>
                  <Input
                    type="number"
                    value={config.triggerThreshold}
                    onChange={(e) => onUpdateConfig({ triggerThreshold: parseInt(e.target.value) || 20 })}
                    className="w-20 h-7 text-xs text-right"
                    min={5}
                    max={100}
                  />
                </div>
                <Slider
                  value={[config.triggerThreshold]}
                  onValueChange={([value]) => onUpdateConfig({ triggerThreshold: value })}
                  min={5}
                  max={100}
                  step={5}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Token 数阈值</Label>
                  <Input
                    type="number"
                    value={config.triggerTokens}
                    onChange={(e) => onUpdateConfig({ triggerTokens: parseInt(e.target.value) || 2000 })}
                    className="w-20 h-7 text-xs text-right"
                    min={500}
                    max={10000}
                    step={500}
                  />
                </div>
              </div>
            </div>

            {/* 摘要设置 */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">摘要设置</Label>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">摘要最大 tokens</Label>
                  <Input
                    type="number"
                    value={config.summaryMaxTokens}
                    onChange={(e) => onUpdateConfig({ summaryMaxTokens: parseInt(e.target.value) || 500 })}
                    className="w-20 h-7 text-xs text-right"
                    min={100}
                    max={2000}
                    step={100}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">保留最近消息数</Label>
                  <Input
                    type="number"
                    value={config.preserveLastN}
                    onChange={(e) => onUpdateConfig({ preserveLastN: parseInt(e.target.value) || 10 })}
                    className="w-20 h-7 text-xs text-right"
                    min={1}
                    max={50}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  最近的 N 条消息不会被摘要
                </p>
              </div>
            </div>

            {/* 插入位置 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">插入位置</Label>
              <Select
                value={config.insertPosition}
                onValueChange={(value) => onUpdateConfig({ insertPosition: value as typeof config.insertPosition })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before_system">系统提示词之前</SelectItem>
                  <SelectItem value="after_system">系统提示词之后</SelectItem>
                  <SelectItem value="before_examples">示例对话之前</SelectItem>
                  <SelectItem value="in_chat">聊天消息中</SelectItem>
                </SelectContent>
              </Select>
              {config.insertPosition === 'in_chat' && (
                <div className="flex items-center justify-between mt-2">
                  <Label className="text-xs">插入深度</Label>
                  <Input
                    type="number"
                    value={config.insertDepth}
                    onChange={(e) => onUpdateConfig({ insertDepth: parseInt(e.target.value) || 4 })}
                    className="w-16 h-7 text-xs text-right"
                    min={1}
                    max={20}
                  />
                </div>
              )}
            </div>

            {/* 其他选项 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">摘要中包含角色名</Label>
                <Switch
                  checked={config.includeNames}
                  onCheckedChange={(checked) => onUpdateConfig({ includeNames: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">分段摘要</Label>
                <Switch
                  checked={config.separateSummaries}
                  onCheckedChange={(checked) => onUpdateConfig({ separateSummaries: checked })}
                />
              </div>
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

// 摘要条目组件
interface SummaryItemProps {
  summary: MemorySummary
  onEdit: () => void
  onDelete: () => void
}

function SummaryItem({ summary, onEdit, onDelete }: SummaryItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="rounded-lg border bg-card">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between p-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 h-7">
              <ChevronDown className={cn(
                'h-3 w-3 transition-transform',
                isExpanded && 'rotate-180'
              )} />
              <span className="text-xs">
                消息 {summary.messageRange.start}-{summary.messageRange.end}
              </span>
            </Button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-xs">
              {summary.tokenCount} tokens
            </Badge>
            {summary.isManual && (
              <Badge variant="outline" className="text-xs">已编辑</Badge>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <div className="px-3 pb-3">
            <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded p-2">
              {summary.content}
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {new Date(summary.createdAt).toLocaleString()}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
