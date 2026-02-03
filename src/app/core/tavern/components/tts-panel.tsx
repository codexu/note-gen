'use client'

import { useState, useCallback } from 'react'
import {
  useTavernTTSStore,
  TavernTTSConfig,
  AVAILABLE_VOICES,
  BUILT_IN_PRESETS,
} from '@/stores/tavern-tts'
import { CharacterVoiceConfigurator, VoicePresetManager } from './voice-config'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
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
  Volume2,
  Settings2,
  ChevronDown,
  HelpCircle,
  Play,
  Square,
} from 'lucide-react'
import { playMessage, stopPlayback } from '@/lib/tavern/tts-service'

interface TTSPanelProps {
  cardId?: number
  characterName?: string
  compact?: boolean
  className?: string
}

export function TTSPanel({
  cardId,
  characterName,
  compact = false,
  className,
}: TTSPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [testPlaying, setTestPlaying] = useState(false)
  const [showVoiceConfig, setShowVoiceConfig] = useState(false)
  const [showPresetManager, setShowPresetManager] = useState(false)

  const {
    config,
    isPlaying,
    getEffectiveConfig,
    updateConfig,
    setCharacterVoice,
    getCharacterVoice,
    clearCharacterVoice,
  } = useTavernTTSStore()

  const effectiveConfig = getEffectiveConfig(cardId)
  const characterVoice = cardId ? getCharacterVoice(cardId) : null

  // 测试播放
  const handleTestPlay = useCallback(async () => {
    if (testPlaying) {
      stopPlayback()
      setTestPlaying(false)
      return
    }

    setTestPlaying(true)
    try {
      await playMessage(
        '你好，这是一段测试语音。Hello, this is a test voice.',
        effectiveConfig,
        undefined,
        (playing) => setTestPlaying(playing)
      )
    } catch (error) {
      console.error('测试播放失败:', error)
    } finally {
      setTestPlaying(false)
    }
  }, [effectiveConfig, testPlaying])

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
                  effectiveConfig.enabled && 'text-purple-600',
                  isPlaying && 'animate-pulse',
                  className
                )}
              >
                <Volume2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>语音合成 ({effectiveConfig.enabled ? '已启用' : '已禁用'})</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80 p-0" align="end">
          <TTSContent
            config={effectiveConfig}
            characterVoice={characterVoice}
            cardId={cardId}
            characterName={characterName}
            onUpdateConfig={updateConfig}
            onSetCharacterVoice={setCharacterVoice}
            onClearCharacterVoice={clearCharacterVoice}
            onTestPlay={handleTestPlay}
            testPlaying={testPlaying}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            presetManagerOpen={showPresetManager}
            onPresetManagerOpenChange={setShowPresetManager}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <TTSContent
        config={effectiveConfig}
        characterVoice={characterVoice}
        cardId={cardId}
        characterName={characterName}
        onUpdateConfig={updateConfig}
        onSetCharacterVoice={setCharacterVoice}
        onClearCharacterVoice={clearCharacterVoice}
        onTestPlay={handleTestPlay}
        testPlaying={testPlaying}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        presetManagerOpen={showPresetManager}
        onPresetManagerOpenChange={setShowPresetManager}
        expanded
      />
    </div>
  )
}

// 内容组件
interface TTSContentProps {
  config: TavernTTSConfig
  characterVoice: { voice: string; speed: number } | null
  cardId?: number
  characterName?: string
  onUpdateConfig: (updates: Partial<TavernTTSConfig>) => void
  onSetCharacterVoice: (cardId: number, config: { voice: string; speed: number }) => void
  onClearCharacterVoice: (cardId: number) => void
  onTestPlay: () => void
  testPlaying: boolean
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  presetManagerOpen: boolean
  onPresetManagerOpenChange: (open: boolean) => void
  expanded?: boolean
}

function TTSContent({
  config,
  characterVoice,
  cardId,
  characterName,
  onUpdateConfig,
  onSetCharacterVoice,
  onClearCharacterVoice,
  onTestPlay,
  testPlaying,
  showAdvanced,
  setShowAdvanced,
  presetManagerOpen,
  onPresetManagerOpenChange,
  expanded = false,
}: TTSContentProps) {
  const [showHelp, setShowHelp] = useState(false)

  // 更新角色语音
  const handleVoiceChange = (voice: string) => {
    if (cardId) {
      onSetCharacterVoice(cardId, {
        voice,
        speed: characterVoice?.speed ?? config.speed,
      })
    } else {
      onUpdateConfig({ voice })
    }
  }

  const handleSpeedChange = (speed: number) => {
    if (cardId && characterVoice) {
      onSetCharacterVoice(cardId, {
        voice: characterVoice.voice,
        speed,
      })
    } else {
      onUpdateConfig({ speed })
    }
  }

  const currentVoice = characterVoice?.voice ?? config.voice
  const currentSpeed = characterVoice?.speed ?? config.speed

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-purple-600" />
          <span className="font-medium text-sm">语音合成</span>
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
                将角色的回复转换为语音朗读。支持 AI TTS 和系统语音。
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
          <p><strong>使用方法:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li>点击消息旁的播放按钮朗读</li>
            <li>可为不同角色设置不同语音</li>
            <li>支持自动朗读 AI 回复</li>
          </ul>
        </div>
      )}

      <ScrollArea className={cn('flex-1', expanded ? 'h-[350px]' : 'max-h-[300px]')}>
        <div className="p-3 space-y-4">
          {/* 语音选择 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">语音类型</Label>
              {cardId && characterVoice && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={() => onClearCharacterVoice(cardId)}
                >
                  重置为默认
                </Button>
              )}
            </div>
            <Select value={currentVoice} onValueChange={handleVoiceChange}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_VOICES.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    <div className="flex flex-col">
                      <span>{voice.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {voice.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 语速 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">语速</Label>
              <span className="text-xs text-muted-foreground">
                {currentSpeed.toFixed(1)}x
              </span>
            </div>
            <Slider
              value={[currentSpeed]}
              onValueChange={([value]) => handleSpeedChange(value)}
              min={0.5}
              max={2.0}
              step={0.1}
              className="w-full"
            />
          </div>

          {/* 测试播放 */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onTestPlay}
          >
            {testPlaying ? (
              <>
                <Square className="h-4 w-4 mr-1" />
                停止测试
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                测试语音
              </>
            )}
          </Button>

          {/* 自动播放设置 */}
          <div className="space-y-2">
            <Label className="text-sm">自动播放</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">自动朗读 AI 回复</Label>
                <Switch
                  checked={config.autoPlay}
                  onCheckedChange={(checked) => onUpdateConfig({ autoPlay: checked })}
                />
              </div>
              {config.autoPlay && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">延迟 (毫秒)</Label>
                  <Input
                    type="number"
                    value={config.autoPlayDelay}
                    onChange={(e) => onUpdateConfig({ autoPlayDelay: parseInt(e.target.value) || 500 })}
                    min={0}
                    max={5000}
                    step={100}
                    className="h-8"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 显示设置 */}
          <div className="space-y-2">
            <Label className="text-sm">显示设置</Label>
            <div className="flex items-center justify-between">
              <Label className="text-xs">显示播放按钮</Label>
              <Switch
                checked={config.showPlayButton}
                onCheckedChange={(checked) => onUpdateConfig({ showPlayButton: checked })}
              />
            </div>
          </div>

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
                <Label className="text-xs">使用系统语音</Label>
                <Switch
                  checked={config.useSystemVoice}
                  onCheckedChange={(checked) => onUpdateConfig({ useSystemVoice: checked })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                系统语音无需 AI 模型，但音质较差
              </p>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">分段大小 (0=不分段)</Label>
                <Input
                  type="number"
                  value={config.chunkSize}
                  onChange={(e) => onUpdateConfig({ chunkSize: parseInt(e.target.value) || 0 })}
                  min={0}
                  max={5000}
                  step={100}
                  className="h-8"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">跳过代码块</Label>
                <Switch
                  checked={config.skipCodeBlocks}
                  onCheckedChange={(checked) => onUpdateConfig({ skipCodeBlocks: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">跳过表情符号</Label>
                <Switch
                  checked={config.skipEmoji}
                  onCheckedChange={(checked) => onUpdateConfig({ skipEmoji: checked })}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 角色声音配置入口 */}
          {cardId && (
            <div className="pt-2 border-t space-y-2">
              <Label className="text-sm">角色声音配置</Label>
              <CharacterVoiceConfigurator
                cardId={cardId}
                characterName={characterName || `角色 ${cardId}`}
                compact
              />
            </div>
          )}

          {/* 声音预设管理 */}
          <div className="pt-2 border-t space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onPresetManagerOpenChange(true)}
            >
              声音预设管理
            </Button>
            <VoicePresetManager
              open={presetManagerOpen}
              onOpenChange={onPresetManagerOpenChange}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
