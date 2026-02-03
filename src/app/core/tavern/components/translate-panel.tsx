'use client'

import { useState, useCallback } from 'react'
import {
  useTavernTranslateStore,
  SUPPORTED_LANGUAGES,
  LanguageCode,
  TranslateMode,
} from '@/stores/tavern-translate'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
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
  Languages,
  ArrowRight,
  Settings2,
  ChevronDown,
  HelpCircle,
  Trash2,
} from 'lucide-react'

interface TranslatePanelProps {
  cardId?: number
  compact?: boolean
  className?: string
}

export function TranslatePanel({
  cardId,
  compact = false,
  className,
}: TranslatePanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    config,
    getEffectiveConfig,
    updateConfig,
    clearCache,
  } = useTavernTranslateStore()

  const effectiveConfig = getEffectiveConfig(cardId)

  // 获取模式显示文本
  const getModeText = (mode: TranslateMode) => {
    switch (mode) {
      case 'off': return '关闭'
      case 'input': return '输入'
      case 'output': return '输出'
      case 'both': return '双向'
    }
  }

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
                  effectiveConfig.enabled && effectiveConfig.mode !== 'off' && 'text-blue-600',
                  className
                )}
              >
                <Languages className="h-4 w-4" />
                {effectiveConfig.enabled && effectiveConfig.mode !== 'off' && (
                  <span className="hidden sm:inline">
                    {getModeText(effectiveConfig.mode)}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>翻译 ({effectiveConfig.enabled ? getModeText(effectiveConfig.mode) : '关闭'})</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <TranslateContent
            config={effectiveConfig}
            onUpdateConfig={updateConfig}
            onClearCache={clearCache}
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
      <TranslateContent
        config={effectiveConfig}
        onUpdateConfig={updateConfig}
        onClearCache={clearCache}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        expanded
      />
    </div>
  )
}


// 内容组件
interface TranslateContentProps {
  config: ReturnType<typeof useTavernTranslateStore.getState>['config']
  onUpdateConfig: (updates: Partial<ReturnType<typeof useTavernTranslateStore.getState>['config']>) => void
  onClearCache: () => void
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  expanded?: boolean
}

function TranslateContent({
  config,
  onUpdateConfig,
  onClearCache,
  showAdvanced,
  setShowAdvanced,
  expanded = false,
}: TranslateContentProps) {
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">实时翻译</span>
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
                使用 AI 进行实时翻译。可以翻译用户输入、AI 输出或双向翻译。
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
          <p><strong>翻译模式:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li><strong>输入</strong> - 翻译你发送的消息</li>
            <li><strong>输出</strong> - 翻译 AI 的回复</li>
            <li><strong>双向</strong> - 同时翻译输入和输出</li>
          </ul>
        </div>
      )}

      <ScrollArea className={cn('flex-1', expanded ? 'h-[350px]' : 'max-h-[300px]')}>
        <div className="p-3 space-y-4">
          {/* 翻译模式 */}
          <div className="space-y-2">
            <Label className="text-sm">翻译模式</Label>
            <Select
              value={config.mode}
              onValueChange={(value) => onUpdateConfig({ mode: value as TranslateMode })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">关闭</SelectItem>
                <SelectItem value="input">输入翻译</SelectItem>
                <SelectItem value="output">输出翻译</SelectItem>
                <SelectItem value="both">双向翻译</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 输入翻译设置 */}
          {(config.mode === 'input' || config.mode === 'both') && (
            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <Label className="text-sm font-medium">输入翻译</Label>
              <p className="text-xs text-muted-foreground">你的消息将被翻译后发送给 AI</p>
              <div className="flex items-center gap-2">
                <Select
                  value={config.inputSourceLang}
                  onValueChange={(value) => onUpdateConfig({ inputSourceLang: value as LanguageCode | 'auto' })}
                >
                  <SelectTrigger className="flex-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动检测</SelectItem>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.nativeName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Select
                  value={config.inputTargetLang}
                  onValueChange={(value) => onUpdateConfig({ inputTargetLang: value as LanguageCode })}
                >
                  <SelectTrigger className="flex-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.nativeName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* 输出翻译设置 */}
          {(config.mode === 'output' || config.mode === 'both') && (
            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <Label className="text-sm font-medium">输出翻译</Label>
              <p className="text-xs text-muted-foreground">AI 的回复将被翻译成你的语言</p>
              <div className="flex items-center gap-2">
                <Select
                  value={config.outputSourceLang}
                  onValueChange={(value) => onUpdateConfig({ outputSourceLang: value as LanguageCode | 'auto' })}
                >
                  <SelectTrigger className="flex-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动检测</SelectItem>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.nativeName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Select
                  value={config.outputTargetLang}
                  onValueChange={(value) => onUpdateConfig({ outputTargetLang: value as LanguageCode })}
                >
                  <SelectTrigger className="flex-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.nativeName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* 显示设置 */}
          {config.mode !== 'off' && (
            <div className="space-y-2">
              <Label className="text-sm">显示设置</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">显示原文</Label>
                  <Switch
                    checked={config.showOriginal}
                    onCheckedChange={(checked) => onUpdateConfig({ showOriginal: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">显示翻译</Label>
                  <Switch
                    checked={config.showTranslation}
                    onCheckedChange={(checked) => onUpdateConfig({ showTranslation: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">内联显示</Label>
                  <Switch
                    checked={config.inlineDisplay}
                    onCheckedChange={(checked) => onUpdateConfig({ inlineDisplay: checked })}
                  />
                </div>
              </div>
            </div>
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
              <div className="flex items-center justify-between">
                <Label className="text-xs">保留格式</Label>
                <Switch
                  checked={config.preserveFormatting}
                  onCheckedChange={(checked) => onUpdateConfig({ preserveFormatting: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">保留角色名</Label>
                <Switch
                  checked={config.preserveNames}
                  onCheckedChange={(checked) => onUpdateConfig({ preserveNames: checked })}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs">自定义提示词</Label>
                <Textarea
                  value={config.customPrompt}
                  onChange={(e) => onUpdateConfig({ customPrompt: e.target.value })}
                  placeholder="额外的翻译要求..."
                  className="min-h-[60px] text-sm resize-none"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive"
                onClick={onClearCache}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                清除翻译缓存
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  )
}
