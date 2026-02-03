'use client'

import { useState, useCallback, useRef, ChangeEvent } from 'react'
import {
  useTavernExpressionsStore,
  Expression,
  ExpressionType,
  CharacterExpressions,
  DEFAULT_EXPRESSION_TYPES,
} from '@/stores/tavern-expressions'
import {
  createDefaultExpressions,
  getExpressionSizeStyle,
} from '@/lib/tavern/expressions-service'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  Smile,
  Settings2,
  ChevronDown,
  HelpCircle,
  Plus,
  Trash2,
  Upload,
  Image as ImageIcon,
  X,
  Sparkles,
} from 'lucide-react'
import { SpriteViewer } from './sprite-viewer'

interface ExpressionsPanelProps {
  cardId: number
  characterName?: string
  compact?: boolean
  className?: string
}

export function ExpressionsPanel({
  cardId,
  characterName,
  compact = false,
  className,
}: ExpressionsPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showSpriteViewer, setShowSpriteViewer] = useState(false)

  const {
    config,
    getCharacterExpressions,
    setCharacterExpressions,
    updateCharacterExpressions,
    updateConfig,
    getCurrentExpression,
  } = useTavernExpressionsStore()

  const charExpressions = getCharacterExpressions(cardId)
  const currentExpression = getCurrentExpression(cardId)

  // 初始化角色表情配置
  const initializeExpressions = useCallback(() => {
    if (!charExpressions) {
      const defaultExpressions = createDefaultExpressions(cardId)
      setCharacterExpressions(cardId, {
        cardId,
        enabled: true,
        defaultExpression: defaultExpressions[0]?.id || '',
        expressions: defaultExpressions,
        position: config.defaultPosition,
        size: config.defaultSize,
        opacity: config.defaultOpacity,
        fadeTransition: config.fadeTransition,
        transitionDuration: config.transitionDuration,
      })
    }
  }, [cardId, charExpressions, config, setCharacterExpressions])

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
                  charExpressions?.enabled && 'text-pink-600',
                  className
                )}
              >
                <Smile className="h-4 w-4" />
                {currentExpression && (
                  <span className="hidden sm:inline text-xs">
                    {currentExpression.name}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>表情立绘 {currentExpression ? `(${currentExpression.name})` : ''}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <ExpressionsContent
            cardId={cardId}
            characterName={characterName}
            config={config}
            charExpressions={charExpressions}
            onUpdateConfig={updateConfig}
            onUpdateCharExpressions={(updates) => updateCharacterExpressions(cardId, updates)}
            onInitialize={initializeExpressions}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            showSpriteViewer={showSpriteViewer}
            setShowSpriteViewer={setShowSpriteViewer}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <ExpressionsContent
        cardId={cardId}
        characterName={characterName}
        config={config}
        charExpressions={charExpressions}
        onUpdateConfig={updateConfig}
        onUpdateCharExpressions={(updates) => updateCharacterExpressions(cardId, updates)}
        onInitialize={initializeExpressions}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        showSpriteViewer={showSpriteViewer}
        setShowSpriteViewer={setShowSpriteViewer}
        expanded
      />
    </div>
  )
}

// 内容组件
interface ExpressionsContentProps {
  cardId: number
  characterName?: string
  config: ReturnType<typeof useTavernExpressionsStore.getState>['config']
  charExpressions: CharacterExpressions | null
  onUpdateConfig: (updates: Partial<ReturnType<typeof useTavernExpressionsStore.getState>['config']>) => void
  onUpdateCharExpressions: (updates: Partial<CharacterExpressions>) => void
  onInitialize: () => void
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  showSpriteViewer: boolean
  setShowSpriteViewer: (show: boolean) => void
  expanded?: boolean
}

function ExpressionsContent({
  cardId,
  characterName,
  config,
  charExpressions,
  onUpdateConfig,
  onUpdateCharExpressions,
  onInitialize,
  showAdvanced,
  setShowAdvanced,
  showSpriteViewer,
  setShowSpriteViewer,
  expanded = false,
}: ExpressionsContentProps) {
  const [showHelp, setShowHelp] = useState(false)
  const [editingExpression, setEditingExpression] = useState<Expression | null>(null)

  const {
    addExpression,
    updateExpression,
    deleteExpression,
  } = useTavernExpressionsStore()

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-pink-600" />
          <span className="font-medium text-sm">表情立绘</span>
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
                根据对话内容自动切换角色的表情立绘。
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
            <li>为每种表情上传对应的立绘图片</li>
            <li>设置触发关键词或使用 AI 检测</li>
            <li>对话时会自动切换表情</li>
          </ul>
        </div>
      )}

      <ScrollArea className={cn('flex-1', expanded ? 'h-[400px]' : 'max-h-[350px]')}>
        <div className="p-3 space-y-4">
          {/* 未初始化时显示初始化按钮 */}
          {!charExpressions ? (
            <div className="text-center py-8">
              <Smile className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                尚未配置此角色的表情
              </p>
              <Button onClick={onInitialize}>
                <Plus className="h-4 w-4 mr-1" />
                初始化表情配置
              </Button>
            </div>
          ) : (
            <>
              {/* 角色表情开关 */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">启用此角色的表情</Label>
                <Switch
                  checked={charExpressions.enabled}
                  onCheckedChange={(enabled) => onUpdateCharExpressions({ enabled })}
                />
              </div>

              {/* 表情列表 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">表情列表</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => {
                      const newExp: Expression = {
                        id: `${cardId}-custom-${Date.now()}`,
                        type: 'custom',
                        name: '新表情',
                        imagePath: '',
                        keywords: [],
                        priority: 1,
                      }
                      addExpression(cardId, newExp)
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    添加
                  </Button>
                </div>
                
                <div className="space-y-2">
                  {charExpressions.expressions.map((expression) => (
                    <ExpressionItem
                      key={expression.id}
                      expression={expression}
                      isDefault={expression.id === charExpressions.defaultExpression}
                      onEdit={() => setEditingExpression(expression)}
                      onDelete={() => deleteExpression(cardId, expression.id)}
                      onSetDefault={() => onUpdateCharExpressions({ defaultExpression: expression.id })}
                    />
                  ))}
                </div>
              </div>

              {/* 显示设置 */}
              <div className="space-y-2">
                <Label className="text-sm">显示设置</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">位置</Label>
                    <Select
                      value={charExpressions.position}
                      onValueChange={(value) => onUpdateCharExpressions({ position: value as 'left' | 'right' | 'background' })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">左侧</SelectItem>
                        <SelectItem value="right">右侧</SelectItem>
                        <SelectItem value="background">背景</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">大小</Label>
                    <Select
                      value={charExpressions.size}
                      onValueChange={(value) => onUpdateCharExpressions({ size: value as 'small' | 'medium' | 'large' | 'full' })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small">小</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="large">大</SelectItem>
                        <SelectItem value="full">全屏</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">透明度</Label>
                    <span className="text-xs">{charExpressions.opacity}%</span>
                  </div>
                  <Slider
                    value={[charExpressions.opacity]}
                    onValueChange={([value]) => onUpdateCharExpressions({ opacity: value })}
                    min={0}
                    max={100}
                    step={5}
                  />
                </div>
              </div>

              {/* 精灵动画入口 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">精灵动画</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => setShowSpriteViewer(!showSpriteViewer)}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    {showSpriteViewer ? '隐藏' : '配置'}
                  </Button>
                </div>
                {showSpriteViewer && (
                  <SpriteViewer
                    characterId={cardId}
                    characterName={characterName || `角色 ${cardId}`}
                    size={{ width: 300, height: 400 }}
                  />
                )}
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
                    <Label className="text-xs">关键词检测</Label>
                    <Switch
                      checked={config.useKeywordDetection}
                      onCheckedChange={(checked) => onUpdateConfig({ useKeywordDetection: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">AI 情绪检测</Label>
                    <Switch
                      checked={config.useAIDetection}
                      onCheckedChange={(checked) => onUpdateConfig({ useAIDetection: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">淡入淡出动画</Label>
                    <Switch
                      checked={charExpressions.fadeTransition}
                      onCheckedChange={(checked) => onUpdateCharExpressions({ fadeTransition: checked })}
                    />
                  </div>
                  {charExpressions.fadeTransition && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">动画时长 (ms)</Label>
                      <Input
                        type="number"
                        value={charExpressions.transitionDuration}
                        onChange={(e) => onUpdateCharExpressions({ transitionDuration: parseInt(e.target.value) || 300 })}
                        min={0}
                        max={2000}
                        step={50}
                        className="h-8"
                      />
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
      </ScrollArea>

      {/* 表情编辑对话框 */}
      {editingExpression && (
        <ExpressionEditDialog
          expression={editingExpression}
          cardId={cardId}
          onClose={() => setEditingExpression(null)}
          onSave={(updates) => {
            updateExpression(cardId, editingExpression.id, updates)
            setEditingExpression(null)
          }}
        />
      )}
    </div>
  )
}

// 表情项组件
interface ExpressionItemProps {
  expression: Expression
  isDefault: boolean
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}

function ExpressionItem({
  expression,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault,
}: ExpressionItemProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
      {/* 缩略图 */}
      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
        {expression.imagePath ? (
          <img
            src={expression.imagePath}
            alt={expression.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      
      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium truncate">{expression.name}</span>
          {isDefault && (
            <Badge variant="secondary" className="text-xs">默认</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {expression.keywords.slice(0, 3).join(', ')}
          {expression.keywords.length > 3 && '...'}
        </div>
      </div>
      
      {/* 操作 */}
      <div className="flex items-center gap-1">
        {!isDefault && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onSetDefault}
          >
            <span className="text-xs">默认</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// 表情编辑对话框
interface ExpressionEditDialogProps {
  expression: Expression
  cardId: number
  onClose: () => void
  onSave: (updates: Partial<Expression>) => void
}

function ExpressionEditDialog({
  expression,
  cardId,
  onClose,
  onSave,
}: ExpressionEditDialogProps) {
  const [name, setName] = useState(expression.name)
  const [keywords, setKeywords] = useState(expression.keywords.join(', '))
  const [priority, setPriority] = useState(expression.priority)
  const [imagePath, setImagePath] = useState(expression.imagePath)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 读取为 Data URL
    const reader = new FileReader()
    reader.onload = () => {
      setImagePath(reader.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleSave = () => {
    onSave({
      name,
      keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      priority,
      imagePath,
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑表情</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 图片预览 */}
          <div className="flex justify-center">
            <div
              className="w-32 h-32 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/50 overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              {imagePath ? (
                <img
                  src={imagePath}
                  alt={name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">点击上传</span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* 名称 */}
          <div className="space-y-1">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="表情名称"
            />
          </div>

          {/* 关键词 */}
          <div className="space-y-1">
            <Label>触发关键词 (逗号分隔)</Label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="开心, 高兴, 哈哈"
            />
          </div>

          {/* 优先级 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>优先级</Label>
              <span className="text-xs text-muted-foreground">{priority}</span>
            </div>
            <Slider
              value={[priority]}
              onValueChange={([value]) => setPriority(value)}
              min={1}
              max={20}
              step={1}
            />
          </div>

          {/* 按钮 */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
