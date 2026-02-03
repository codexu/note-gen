'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Pencil, ChevronDown, RotateCcw } from 'lucide-react'
import {
  useTavernAuthorsNoteStore,
  AuthorsNotePosition,
  AuthorsNoteRole,
  getPositionDisplayName,
  getRoleDisplayName,
} from '@/stores/tavern-authors-note'
import { cn } from '@/lib/utils'

interface AuthorsNotePanelProps {
  cardId?: number
  chatId?: number
  compact?: boolean
}

export function AuthorsNotePanel({
  cardId,
  chatId,
  compact = false,
}: AuthorsNotePanelProps) {
  const {
    getEffectiveConfig,
    setGlobalConfig,
    setCharacterConfig,
    setChatOverride,
    clearChatOverride,
  } = useTavernAuthorsNoteStore()

  const [isOpen, setIsOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  
  const config = getEffectiveConfig(cardId, chatId)
  
  // 更新配置的辅助函数
  const updateConfig = (updates: Partial<typeof config>) => {
    if (chatId) {
      setChatOverride(chatId, updates)
    } else if (cardId) {
      setCharacterConfig(cardId, updates)
    } else {
      setGlobalConfig(updates)
    }
  }

  // 重置为默认
  const handleReset = () => {
    if (chatId) {
      clearChatOverride(chatId)
    }
  }

  // 紧凑模式 - 只显示按钮
  if (compact) {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 gap-1 text-xs',
              config.enabled && config.content && 'text-amber-600'
            )}
          >
            <Pencil className="h-4 w-4" />
            <span className="hidden sm:inline">笔记</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>作者笔记</SheetTitle>
            <SheetDescription>
              添加额外的上下文提示，引导 AI 的回复方向
            </SheetDescription>
          </SheetHeader>
          <AuthorsNoteForm
            config={config}
            onUpdate={updateConfig}
            onReset={chatId ? handleReset : undefined}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
          />
        </SheetContent>
      </Sheet>
    )
  }

  // 完整模式 - 内联显示
  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">作者笔记</h3>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>
      {config.enabled && (
        <AuthorsNoteForm
          config={config}
          onUpdate={updateConfig}
          onReset={chatId ? handleReset : undefined}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
        />
      )}
    </div>
  )
}

interface AuthorsNoteFormProps {
  config: ReturnType<typeof useTavernAuthorsNoteStore.getState>['globalConfig']
  onUpdate: (updates: Partial<ReturnType<typeof useTavernAuthorsNoteStore.getState>['globalConfig']>) => void
  onReset?: () => void
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
}

function AuthorsNoteForm({
  config,
  onUpdate,
  onReset,
  advancedOpen,
  setAdvancedOpen,
}: AuthorsNoteFormProps) {
  return (
    <div className="space-y-4 mt-4">
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <Label>启用</Label>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onUpdate({ enabled })}
        />
      </div>

      {/* 笔记内容 */}
      <div className="space-y-2">
        <Label>笔记内容</Label>
        <Textarea
          value={config.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder="输入要注入到上下文中的提示词..."
          rows={4}
          disabled={!config.enabled}
        />
        <p className="text-xs text-muted-foreground">
          这段文字会被插入到对话上下文中，用于引导 AI 的回复风格或内容
        </p>
      </div>

      {/* 高级设置 */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between">
            高级设置
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                advancedOpen && 'rotate-180'
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          {/* 插入位置 */}
          <div className="space-y-2">
            <Label>插入位置</Label>
            <Select
              value={config.position.toString()}
              onValueChange={(v) =>
                onUpdate({ position: parseInt(v) as AuthorsNotePosition })
              }
              disabled={!config.enabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AuthorsNotePosition.BeforeScenario.toString()}>
                  {getPositionDisplayName(AuthorsNotePosition.BeforeScenario)}
                </SelectItem>
                <SelectItem value={AuthorsNotePosition.AfterScenario.toString()}>
                  {getPositionDisplayName(AuthorsNotePosition.AfterScenario)}
                </SelectItem>
                <SelectItem value={AuthorsNotePosition.InChat.toString()}>
                  {getPositionDisplayName(AuthorsNotePosition.InChat)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 深度 (仅 InChat 时显示) */}
          {config.position === AuthorsNotePosition.InChat && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>插入深度</Label>
                <span className="text-sm text-muted-foreground">
                  {config.depth}
                </span>
              </div>
              <Slider
                value={[config.depth]}
                onValueChange={([depth]) => onUpdate({ depth })}
                min={0}
                max={100}
                step={1}
                disabled={!config.enabled}
              />
              <p className="text-xs text-muted-foreground">
                0 = 最新消息之后，数值越大越靠前
              </p>
            </div>
          )}

          {/* 消息角色 */}
          <div className="space-y-2">
            <Label>消息角色</Label>
            <Select
              value={config.role}
              onValueChange={(v) => onUpdate({ role: v as AuthorsNoteRole })}
              disabled={!config.enabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AuthorsNoteRole.System}>
                  {getRoleDisplayName(AuthorsNoteRole.System)}
                </SelectItem>
                <SelectItem value={AuthorsNoteRole.User}>
                  {getRoleDisplayName(AuthorsNoteRole.User)}
                </SelectItem>
                <SelectItem value={AuthorsNoteRole.Assistant}>
                  {getRoleDisplayName(AuthorsNoteRole.Assistant)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 触发间隔 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>触发间隔</Label>
              <span className="text-sm text-muted-foreground">
                {config.interval === 0 ? '每次' : `每 ${config.interval} 条`}
              </span>
            </div>
            <Slider
              value={[config.interval]}
              onValueChange={([interval]) => onUpdate({ interval })}
              min={0}
              max={20}
              step={1}
              disabled={!config.enabled}
            />
            <p className="text-xs text-muted-foreground">
              0 = 每次生成都插入，N = 每 N 条消息插入一次
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 重置按钮 */}
      {onReset && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="w-full"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          重置为角色默认
        </Button>
      )}
    </div>
  )
}

export default AuthorsNotePanel
