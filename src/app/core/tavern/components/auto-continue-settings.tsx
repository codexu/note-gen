'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Info, Repeat, Target, Hash } from 'lucide-react'
import { useTavernAutoContinueStore } from '@/stores/tavern-auto-continue'

interface AutoContinueSettingsProps {
  /** 是否紧凑模式 */
  compact?: boolean
}

/**
 * 自动继续设置面板
 * 配置 AI 生成长度不足时的自动继续行为
 */
export function AutoContinueSettings({ compact = false }: AutoContinueSettingsProps) {
  const {
    enabled,
    allowChatCompletions,
    targetLength,
    maxContinues,
    updateConfig,
  } = useTavernAutoContinueStore()

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="auto-continue-enabled" className="text-sm">
              自动继续
            </Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">当 AI 回复长度不足目标时，自动请求继续生成</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Switch
            id="auto-continue-enabled"
            checked={enabled}
            onCheckedChange={(v) => updateConfig({ enabled: v })}
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">目标长度</Label>
              </div>
              <div className="flex items-center gap-2">
                <Slider
                  value={[targetLength]}
                  onValueChange={([v]) => updateConfig({ targetLength: v })}
                  min={100}
                  max={2000}
                  step={50}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground w-12 text-right">
                  {targetLength}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm">最大次数</Label>
              </div>
              <Input
                type="number"
                value={maxContinues}
                onChange={(e) => updateConfig({ maxContinues: Number(e.target.value) || 1 })}
                min={1}
                max={10}
                className="w-16 h-8 text-center"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="allow-chat" className="text-sm">
                允许 Chat API
              </Label>
              <Switch
                id="allow-chat"
                checked={allowChatCompletions}
                onCheckedChange={(v) => updateConfig({ allowChatCompletions: v })}
              />
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="h-5 w-5" />
          自动继续
        </CardTitle>
        <CardDescription>
          当 AI 生成的回复长度不足目标时，自动触发继续生成
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 启用开关 */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-continue-enabled-full">启用自动继续</Label>
            <p className="text-sm text-muted-foreground">
              回复长度不足时自动请求更多内容
            </p>
          </div>
          <Switch
            id="auto-continue-enabled-full"
            checked={enabled}
            onCheckedChange={(v) => updateConfig({ enabled: v })}
          />
        </div>

        {enabled && (
          <>
            {/* 目标长度 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>目标长度 (字符)</Label>
                <span className="text-sm font-medium">{targetLength}</span>
              </div>
              <Slider
                value={[targetLength]}
                onValueChange={([v]) => updateConfig({ targetLength: v })}
                min={100}
                max={2000}
                step={50}
              />
              <p className="text-xs text-muted-foreground">
                当回复少于此字符数时触发继续生成
              </p>
            </div>

            {/* 最大继续次数 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="max-continues">最大继续次数</Label>
                <Input
                  id="max-continues"
                  type="number"
                  value={maxContinues}
                  onChange={(e) => updateConfig({ maxContinues: Number(e.target.value) || 1 })}
                  min={1}
                  max={10}
                  className="w-20 text-center"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                防止无限循环，最多继续生成的次数
              </p>
            </div>

            {/* Chat API 开关 */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allow-chat-completions">允许 Chat Completions API</Label>
                <p className="text-sm text-muted-foreground">
                  部分 Chat API 可能不支持良好的继续生成
                </p>
              </div>
              <Switch
                id="allow-chat-completions"
                checked={allowChatCompletions}
                onCheckedChange={(v) => updateConfig({ allowChatCompletions: v })}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 自动继续状态指示器
 * 显示当前是否正在进行自动继续
 */
export function AutoContinueIndicator({
  continueCount,
  isActive,
}: {
  continueCount: number
  isActive: boolean
}) {
  if (!isActive && continueCount === 0) return null

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Repeat className={`h-3 w-3 ${isActive ? 'animate-spin' : ''}`} />
      <span>
        {isActive ? `继续生成中 (${continueCount})...` : `已继续 ${continueCount} 次`}
      </span>
    </div>
  )
}
