'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTavernCfgScaleStore, CfgLevel } from '@/stores/tavern-cfg-scale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  Gauge,
  ChevronDown,
  Globe,
  User,
  MessageSquare,
  HelpCircle,
  Settings2,
  Trash2,
} from 'lucide-react'

interface CfgScalePanelProps {
  cardId?: number
  chatId?: number
  compact?: boolean
  className?: string
}

export function CfgScalePanel({
  cardId,
  chatId,
  compact = false,
  className,
}: CfgScalePanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<CfgLevel>('chat')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    globalConfig,
    characterConfigs,
    chatConfigs,
    promptCombine,
    insertionDepth,
    promptSeparator,
    isEnabled,
    updateGlobalConfig,
    updateCharacterConfig,
    updateChatConfig,
    clearCharacterConfig,
    clearChatConfig,
    togglePromptCombine,
    setInsertionDepth,
    setPromptSeparator,
  } = useTavernCfgScaleStore()

  // 获取当前配置
  const charConfig = cardId ? characterConfigs[cardId] : undefined
  const currentChatConfig = chatId ? chatConfigs[chatId] : undefined

  // 检查是否启用
  const cfgEnabled = isEnabled(cardId, chatId)

  // 获取当前 tab 的配置
  const getCurrentConfig = useCallback(() => {
    switch (activeTab) {
      case 'global':
        return globalConfig
      case 'character':
        return charConfig || { guidanceScale: 1.0, negativePrompt: '', positivePrompt: '' }
      case 'chat':
        return currentChatConfig || { guidanceScale: 1.0, negativePrompt: '', positivePrompt: '' }
    }
  }, [activeTab, globalConfig, charConfig, currentChatConfig])

  // 更新当前 tab 的配置
  const updateCurrentConfig = useCallback((updates: { guidanceScale?: number; negativePrompt?: string; positivePrompt?: string }) => {
    switch (activeTab) {
      case 'global':
        updateGlobalConfig(updates)
        break
      case 'character':
        if (cardId) updateCharacterConfig(cardId, updates)
        break
      case 'chat':
        if (chatId) updateChatConfig(chatId, updates)
        break
    }
  }, [activeTab, cardId, chatId, updateGlobalConfig, updateCharacterConfig, updateChatConfig])

  // 清除当前配置
  const clearCurrentConfig = useCallback(() => {
    switch (activeTab) {
      case 'character':
        if (cardId) clearCharacterConfig(cardId)
        break
      case 'chat':
        if (chatId) clearChatConfig(chatId)
        break
    }
  }, [activeTab, cardId, chatId, clearCharacterConfig, clearChatConfig])

  const config = getCurrentConfig()

  // 紧凑模式
  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 gap-1 text-xs',
                  cfgEnabled && 'text-orange-600',
                  className
                )}
              >
                <Gauge className="h-4 w-4" />
                {cfgEnabled && (
                  <span className="hidden sm:inline">
                    {globalConfig.guidanceScale.toFixed(1)}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>CFG Scale {cfgEnabled ? '(已启用)' : '(已禁用)'}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <CfgScaleContent
            config={config}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onUpdate={updateCurrentConfig}
            onClear={clearCurrentConfig}
            cardId={cardId}
            chatId={chatId}
            promptCombine={promptCombine}
            insertionDepth={insertionDepth}
            promptSeparator={promptSeparator}
            onTogglePromptCombine={togglePromptCombine}
            onSetInsertionDepth={setInsertionDepth}
            onSetPromptSeparator={setPromptSeparator}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <CfgScaleContent
        config={config}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onUpdate={updateCurrentConfig}
        onClear={clearCurrentConfig}
        cardId={cardId}
        chatId={chatId}
        promptCombine={promptCombine}
        insertionDepth={insertionDepth}
        promptSeparator={promptSeparator}
        onTogglePromptCombine={togglePromptCombine}
        onSetInsertionDepth={setInsertionDepth}
        onSetPromptSeparator={setPromptSeparator}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        expanded
      />
    </div>
  )
}


// 内容组件
interface CfgScaleContentProps {
  config: { guidanceScale: number; negativePrompt: string; positivePrompt: string }
  activeTab: CfgLevel
  setActiveTab: (tab: CfgLevel) => void
  onUpdate: (updates: { guidanceScale?: number; negativePrompt?: string; positivePrompt?: string }) => void
  onClear: () => void
  cardId?: number
  chatId?: number
  promptCombine: CfgLevel[]
  insertionDepth: number
  promptSeparator: string
  onTogglePromptCombine: (level: CfgLevel) => void
  onSetInsertionDepth: (depth: number) => void
  onSetPromptSeparator: (separator: string) => void
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  expanded?: boolean
}

function CfgScaleContent({
  config,
  activeTab,
  setActiveTab,
  onUpdate,
  onClear,
  cardId,
  chatId,
  promptCombine,
  insertionDepth,
  promptSeparator,
  onTogglePromptCombine,
  onSetInsertionDepth,
  onSetPromptSeparator,
  showAdvanced,
  setShowAdvanced,
  expanded = false,
}: CfgScaleContentProps) {
  const [showHelp, setShowHelp] = useState(false)

  // 获取缩放值的颜色
  const getScaleColor = (value: number) => {
    if (value === 1.0) return 'text-muted-foreground'
    if (value < 1.5) return 'text-green-500'
    if (value < 2.0) return 'text-yellow-500'
    return 'text-orange-500'
  }

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-orange-600" />
          <span className="font-medium text-sm">CFG Scale</span>
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
                CFG (Classifier-Free Guidance) 通过负面提示词引导模型生成。
                缩放值越高，负面提示词的影响越强。
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className={cn(
          'text-sm font-mono',
          getScaleColor(config.guidanceScale)
        )}>
          {config.guidanceScale.toFixed(2)}
        </div>
      </div>

      {/* 帮助信息 */}
      {showHelp && (
        <div className="p-3 bg-muted/50 border-b text-xs space-y-1">
          <p><strong>CFG Scale:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li><code>1.0</code> - 禁用 CFG</li>
            <li><code>1.0-1.5</code> - 轻微引导</li>
            <li><code>1.5-2.0</code> - 中等引导</li>
            <li><code>&gt;2.0</code> - 强引导 (可能影响质量)</li>
          </ul>
          <p className="mt-2"><strong>负面提示词:</strong> 描述你不想要的内容</p>
          <p className="text-muted-foreground">例如: &ldquo;重复、无聊、离题&rdquo;</p>
        </div>
      )}

      {/* Tab 切换 */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CfgLevel)} className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-9 m-2 mb-0">
          <TabsTrigger value="chat" className="text-xs gap-1" disabled={!chatId}>
            <MessageSquare className="h-3 w-3" />
            聊天
          </TabsTrigger>
          <TabsTrigger value="character" className="text-xs gap-1" disabled={!cardId}>
            <User className="h-3 w-3" />
            角色
          </TabsTrigger>
          <TabsTrigger value="global" className="text-xs gap-1">
            <Globe className="h-3 w-3" />
            全局
          </TabsTrigger>
        </TabsList>

        <ScrollArea className={cn('flex-1', expanded ? 'h-[350px]' : 'max-h-[300px]')}>
          <div className="p-3 space-y-4">
            {/* Guidance Scale 滑块 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">引导缩放</Label>
                <Input
                  type="number"
                  value={config.guidanceScale}
                  onChange={(e) => onUpdate({ guidanceScale: parseFloat(e.target.value) || 1.0 })}
                  className="w-20 h-7 text-xs text-right"
                  step={0.05}
                  min={1}
                  max={3}
                />
              </div>
              <Slider
                value={[config.guidanceScale]}
                onValueChange={([value]) => onUpdate({ guidanceScale: value })}
                min={1}
                max={3}
                step={0.05}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1.0 (禁用)</span>
                <span>3.0 (强)</span>
              </div>
            </div>

            {/* 负面提示词 */}
            <div className="space-y-2">
              <Label className="text-sm">负面提示词</Label>
              <Textarea
                value={config.negativePrompt}
                onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
                placeholder="描述你不想要的内容..."
                className="min-h-[60px] text-sm resize-none"
              />
            </div>

            {/* 正面提示词 (可选) */}
            <div className="space-y-2">
              <Label className="text-sm">正面提示词 (可选)</Label>
              <Textarea
                value={config.positivePrompt}
                onChange={(e) => onUpdate({ positivePrompt: e.target.value })}
                placeholder="描述你想要强调的内容..."
                className="min-h-[60px] text-sm resize-none"
              />
            </div>

            {/* 清除按钮 (非全局) */}
            {activeTab !== 'global' && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive"
                onClick={onClear}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                清除{activeTab === 'chat' ? '聊天' : '角色'}配置
              </Button>
            )}

            {/* 高级设置 */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-1">
                    <Settings2 className="h-4 w-4" />
                    高级设置
                  </span>
                  <ChevronDown className={cn(
                    'h-4 w-4 transition-transform',
                    showAdvanced && 'rotate-180'
                  )} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {/* 提示词组合 */}
                <div className="space-y-2">
                  <Label className="text-sm">提示词组合</Label>
                  <p className="text-xs text-muted-foreground">
                    选择要合并的提示词级别
                  </p>
                  <div className="flex flex-col gap-2">
                    {(['global', 'character', 'chat'] as CfgLevel[]).map((level) => (
                      <div key={level} className="flex items-center gap-2">
                        <Checkbox
                          id={`combine-${level}`}
                          checked={promptCombine.includes(level)}
                          onCheckedChange={() => onTogglePromptCombine(level)}
                        />
                        <Label htmlFor={`combine-${level}`} className="text-sm">
                          {level === 'global' ? '全局' : level === 'character' ? '角色' : '聊天'}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 插入深度 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">插入深度</Label>
                    <Input
                      type="number"
                      value={insertionDepth}
                      onChange={(e) => onSetInsertionDepth(parseInt(e.target.value) || 1)}
                      className="w-16 h-7 text-xs text-right"
                      min={0}
                      max={100}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    负面提示词在上下文中的插入位置 (从底部算起)
                  </p>
                </div>

                {/* 分隔符 */}
                <div className="space-y-2">
                  <Label className="text-sm">提示词分隔符</Label>
                  <Input
                    value={promptSeparator === '\n' ? '\\n' : promptSeparator}
                    onChange={(e) => {
                      const value = e.target.value === '\\n' ? '\n' : e.target.value
                      onSetPromptSeparator(value)
                    }}
                    placeholder="\n"
                    className="h-8 text-sm font-mono"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
