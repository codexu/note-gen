'use client'

import { useState, useCallback, useRef, ChangeEvent } from 'react'
import {
  useTavernImageCaptionStore,
  ImageAttachment,
  ImageCaptionConfig,
} from '@/stores/tavern-image-caption'
import {
  createImageAttachment,
  generateCaption,
  getImageFromClipboard,
} from '@/lib/tavern/image-caption-service'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
  Image as ImageIcon,
  Upload,
  X,
  Sparkles,
  Settings2,
  ChevronDown,
  HelpCircle,
  Clipboard,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'

interface ImageCaptionPanelProps {
  cardId?: number
  compact?: boolean
  className?: string
  onImagesChange?: (images: ImageAttachment[]) => void
}

export function ImageCaptionPanel({
  cardId,
  compact = false,
  className,
  onImagesChange,
}: ImageCaptionPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    config,
    pendingImages,
    getEffectiveConfig,
    updateConfig,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
    updatePendingImageCaption,
  } = useTavernImageCaptionStore()

  const effectiveConfig = getEffectiveConfig(cardId)

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
                  pendingImages.length > 0 && 'text-green-600',
                  className
                )}
              >
                <ImageIcon className="h-4 w-4" />
                {pendingImages.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1 text-xs">
                    {pendingImages.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>图片描述 {pendingImages.length > 0 ? `(${pendingImages.length} 张)` : ''}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <ImageCaptionContent
            config={effectiveConfig}
            pendingImages={pendingImages}
            onUpdateConfig={updateConfig}
            onAddImage={addPendingImage}
            onRemoveImage={removePendingImage}
            onClearImages={clearPendingImages}
            onUpdateCaption={updatePendingImageCaption}
            onImagesChange={onImagesChange}
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
      <ImageCaptionContent
        config={effectiveConfig}
        pendingImages={pendingImages}
        onUpdateConfig={updateConfig}
        onAddImage={addPendingImage}
        onRemoveImage={removePendingImage}
        onClearImages={clearPendingImages}
        onUpdateCaption={updatePendingImageCaption}
        onImagesChange={onImagesChange}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        expanded
      />
    </div>
  )
}

// 内容组件
interface ImageCaptionContentProps {
  config: ImageCaptionConfig
  pendingImages: ImageAttachment[]
  onUpdateConfig: (updates: Partial<ImageCaptionConfig>) => void
  onAddImage: (image: ImageAttachment) => void
  onRemoveImage: (imageId: string) => void
  onClearImages: () => void
  onUpdateCaption: (imageId: string, caption: string) => void
  onImagesChange?: (images: ImageAttachment[]) => void
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  expanded?: boolean
}

function ImageCaptionContent({
  config,
  pendingImages,
  onUpdateConfig,
  onAddImage,
  onRemoveImage,
  onClearImages,
  onUpdateCaption,
  onImagesChange,
  showAdvanced,
  setShowAdvanced,
  expanded = false,
}: ImageCaptionContentProps) {
  const [showHelp, setShowHelp] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [generatingProgress, setGeneratingProgress] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 处理文件选择
  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      
      const attachment = await createImageAttachment(file)
      if (attachment) {
        onAddImage(attachment)
        onImagesChange?.([...pendingImages, attachment])
      }
    }

    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [onAddImage, onImagesChange, pendingImages])

  // 从剪贴板粘贴
  const handlePaste = useCallback(async () => {
    const attachment = await getImageFromClipboard()
    if (attachment) {
      onAddImage(attachment)
      onImagesChange?.([...pendingImages, attachment])
    }
  }, [onAddImage, onImagesChange, pendingImages])

  // 生成描述
  const handleGenerateCaption = useCallback(async (image: ImageAttachment) => {
    if (generatingId) return

    setGeneratingId(image.id)
    setGeneratingProgress('')

    try {
      const result = await generateCaption(
        image,
        config,
        (content) => setGeneratingProgress(content)
      )

      if (result.success && result.caption) {
        onUpdateCaption(image.id, result.caption)
      }
    } catch (error) {
      console.error('生成描述失败:', error)
    } finally {
      setGeneratingId(null)
      setGeneratingProgress('')
    }
  }, [config, generatingId, onUpdateCaption])

  // 移除图片
  const handleRemoveImage = useCallback((imageId: string) => {
    onRemoveImage(imageId)
    const newImages = pendingImages.filter(img => img.id !== imageId)
    onImagesChange?.(newImages)
  }, [onRemoveImage, onImagesChange, pendingImages])

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-green-600" />
          <span className="font-medium text-sm">图片描述</span>
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
                上传图片并使用 AI 生成描述，描述可以包含在对话上下文中。
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
            <li>点击上传或从剪贴板粘贴图片</li>
            <li>点击生成按钮获取 AI 描述</li>
            <li>描述会自动包含在对话上下文中</li>
          </ul>
        </div>
      )}

      <ScrollArea className={cn('flex-1', expanded ? 'h-[400px]' : 'max-h-[350px]')}>
        <div className="p-3 space-y-4">
          {/* 上传区域 */}
          <div className="space-y-2">
            <Label className="text-sm">添加图片</Label>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                上传图片
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePaste}
              >
                <Clipboard className="h-4 w-4 mr-1" />
                粘贴
              </Button>
            </div>
          </div>

          {/* 待发送图片列表 */}
          {pendingImages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">待发送图片 ({pendingImages.length})</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive"
                  onClick={onClearImages}
                >
                  清空全部
                </Button>
              </div>
              <div className="space-y-3">
                {pendingImages.map((image) => (
                  <ImagePreviewCard
                    key={image.id}
                    image={image}
                    config={config}
                    isGenerating={generatingId === image.id}
                    generatingProgress={generatingId === image.id ? generatingProgress : ''}
                    onRemove={() => handleRemoveImage(image.id)}
                    onGenerateCaption={() => handleGenerateCaption(image)}
                    onUpdateCaption={(caption) => onUpdateCaption(image.id, caption)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 描述设置 */}
          <div className="space-y-2">
            <Label className="text-sm">描述设置</Label>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">详细程度</Label>
                <Select
                  value={config.detailLevel}
                  onValueChange={(value) => onUpdateConfig({ detailLevel: value as 'low' | 'medium' | 'high' })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">简洁</SelectItem>
                    <SelectItem value="medium">适中</SelectItem>
                    <SelectItem value="high">详细</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">自动生成描述</Label>
                <Switch
                  checked={config.autoCaption}
                  onCheckedChange={(checked) => onUpdateConfig({ autoCaption: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">包含在上下文中</Label>
                <Switch
                  checked={config.includeInContext}
                  onCheckedChange={(checked) => onUpdateConfig({ includeInContext: checked })}
                />
              </div>
            </div>
          </div>

          {/* 显示设置 */}
          <div className="space-y-2">
            <Label className="text-sm">显示设置</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">显示缩略图</Label>
                <Switch
                  checked={config.showThumbnail}
                  onCheckedChange={(checked) => onUpdateConfig({ showThumbnail: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">显示描述</Label>
                <Switch
                  checked={config.showCaption}
                  onCheckedChange={(checked) => onUpdateConfig({ showCaption: checked })}
                />
              </div>
              {config.showThumbnail && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">缩略图大小</Label>
                  <Input
                    type="number"
                    value={config.thumbnailSize}
                    onChange={(e) => onUpdateConfig({ thumbnailSize: parseInt(e.target.value) || 150 })}
                    min={50}
                    max={300}
                    className="h-8"
                  />
                </div>
              )}
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
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">最大 Token 数</Label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => onUpdateConfig({ maxTokens: parseInt(e.target.value) || 300 })}
                  min={50}
                  max={1000}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">描述提示词</Label>
                <Textarea
                  value={config.captionPrompt}
                  onChange={(e) => onUpdateConfig({ captionPrompt: e.target.value })}
                  placeholder="请描述这张图片..."
                  className="min-h-[60px] text-sm resize-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">上下文模板</Label>
                <Input
                  value={config.contextTemplate}
                  onChange={(e) => onUpdateConfig({ contextTemplate: e.target.value })}
                  placeholder="[图片描述: {{caption}}]"
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  使用 {'{{caption}}'} 作为描述占位符
                </p>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">缓存描述</Label>
                <Switch
                  checked={config.cacheDescriptions}
                  onCheckedChange={(checked) => onUpdateConfig({ cacheDescriptions: checked })}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  )
}

// 图片预览卡片
interface ImagePreviewCardProps {
  image: ImageAttachment
  config: ImageCaptionConfig
  isGenerating: boolean
  generatingProgress: string
  onRemove: () => void
  onGenerateCaption: () => void
  onUpdateCaption: (caption: string) => void
}

function ImagePreviewCard({
  image,
  config,
  isGenerating,
  generatingProgress,
  onRemove,
  onGenerateCaption,
  onUpdateCaption,
}: ImagePreviewCardProps) {
  const [showCaption, setShowCaption] = useState(true)
  const [isEditingCaption, setIsEditingCaption] = useState(false)
  const [editCaption, setEditCaption] = useState(image.caption || '')

  const handleSaveCaption = useCallback(() => {
    onUpdateCaption(editCaption)
    setIsEditingCaption(false)
  }, [editCaption, onUpdateCaption])

  return (
    <div className="rounded-lg border bg-muted/30 p-2 space-y-2">
      <div className="flex gap-2">
        {/* 缩略图 */}
        {config.showThumbnail && (
          <div
            className="flex-shrink-0 rounded overflow-hidden bg-muted"
            style={{ width: Math.min(config.thumbnailSize, 100), height: Math.min(config.thumbnailSize, 100) }}
          >
            <img
              src={image.thumbnailDataUrl || image.dataUrl}
              alt={image.filename}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        
        {/* 信息 */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium truncate">{image.filename}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive"
              onClick={onRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {image.width && image.height && `${image.width}×${image.height} · `}
            {(image.size / 1024).toFixed(1)} KB
          </div>
          
          {/* 生成按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onGenerateCaption}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3 mr-1" />
                  生成描述
                </>
              )}
            </Button>
            {image.caption && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowCaption(!showCaption)}
              >
                {showCaption ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 生成进度 */}
      {isGenerating && generatingProgress && (
        <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
          {generatingProgress.slice(0, 100)}...
        </div>
      )}

      {/* 描述 */}
      {image.caption && showCaption && config.showCaption && (
        <div className="space-y-1">
          {isEditingCaption ? (
            <div className="space-y-2">
              <Textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                className="min-h-[60px] text-xs resize-none"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setEditCaption(image.caption || '')
                    setIsEditingCaption(false)
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs"
                  onClick={handleSaveCaption}
                >
                  保存
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="text-xs text-muted-foreground p-2 bg-muted rounded cursor-pointer hover:bg-muted/80"
              onClick={() => {
                setEditCaption(image.caption || '')
                setIsEditingCaption(true)
              }}
            >
              {image.caption}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
