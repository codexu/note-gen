'use client'

/**
 * 精灵查看器组件
 * 显示角色精灵图并支持动画
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Play,
  Pause,
  Square,
  Plus,
  Trash2,
  Settings,
  Layers,
  Image,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  MoreVertical,
  Copy,
  Edit,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import {
  SpriteAnimator,
  SpriteLayer,
  SpriteGroup,
  SpriteAnimation,
  SpriteCharacter,
  AnimationKeyframe,
  EasingFunction,
  createDefaultSpriteGroup,
  createFadeInAnimation,
  createFadeOutAnimation,
  createBounceAnimation,
  createShakeAnimation,
  createBreathingAnimation,
  EXPRESSION_TRIGGERS,
} from '@/lib/tavern/sprite-animator'

// ============ 类型 ============

interface SpriteViewerProps {
  /** 角色 ID */
  characterId: number
  /** 角色名称 */
  characterName: string
  /** 初始精灵配置 */
  initialConfig?: SpriteCharacter
  /** 配置变更回调 */
  onConfigChange?: (config: SpriteCharacter) => void
  /** 只读模式 */
  readOnly?: boolean
  /** 是否自动播放呼吸动画 */
  autoBreathing?: boolean
  /** 容器尺寸 */
  size?: { width: number; height: number }
}

// ============ 主组件 ============

export function SpriteViewer({
  characterId,
  characterName,
  initialConfig,
  onConfigChange,
  readOnly = false,
  autoBreathing = true,
  size = { width: 400, height: 600 },
}: SpriteViewerProps) {
  // 精灵配置
  const [config, setConfig] = useState<SpriteCharacter>(() => initialConfig || {
    id: `sprite-${characterId}`,
    characterId,
    baseSize: size,
    groups: [],
    animations: [
      createFadeInAnimation(),
      createFadeOutAnimation(),
      createBounceAnimation(),
      createShakeAnimation(),
      createBreathingAnimation(),
    ],
    transitionDuration: 300,
  })
  
  // 渲染的图层
  const [renderedLayers, setRenderedLayers] = useState<SpriteLayer[]>([])
  
  // 动画器实例
  const animatorRef = useRef<SpriteAnimator | null>(null)
  
  // 当前播放状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentAnimation, setCurrentAnimation] = useState<string | null>(null)
  
  // 编辑模式
  const [editMode, setEditMode] = useState<'view' | 'groups' | 'animations' | 'layers'>('view')
  
  // 对话框状态
  const [showGroupDialog, setShowGroupDialog] = useState(false)
  const [showAnimationDialog, setShowAnimationDialog] = useState(false)
  const [showLayerDialog, setShowLayerDialog] = useState(false)
  const [editingGroup, setEditingGroup] = useState<SpriteGroup | null>(null)
  const [editingAnimation, setEditingAnimation] = useState<SpriteAnimation | null>(null)
  const [editingLayer, setEditingLayer] = useState<{ groupId: string; layer: SpriteLayer } | null>(null)
  
  // 初始化动画器
  useEffect(() => {
    animatorRef.current = new SpriteAnimator(
      config,
      (layers) => setRenderedLayers(layers),
      (animationId) => {
        setIsPlaying(false)
        setCurrentAnimation(null)
      }
    )
    
    // 初始渲染
    setRenderedLayers(animatorRef.current.getCurrentLayers())
    
    // 自动播放呼吸动画
    if (autoBreathing && config.animations.find(a => a.id === 'breathing')) {
      animatorRef.current.playAnimation('breathing')
      setIsPlaying(true)
      setCurrentAnimation('breathing')
    }
    
    return () => {
      animatorRef.current?.destroy()
    }
  }, [config, autoBreathing])
  
  // 配置变更通知
  useEffect(() => {
    onConfigChange?.(config)
  }, [config, onConfigChange])
  
  // 播放动画
  const playAnimation = useCallback((animationId: string) => {
    animatorRef.current?.playAnimation(animationId)
    setIsPlaying(true)
    setCurrentAnimation(animationId)
  }, [])
  
  // 停止动画
  const stopAnimation = useCallback(() => {
    animatorRef.current?.stopAnimation()
    setIsPlaying(false)
    setCurrentAnimation(null)
  }, [])
  
  // 切换表情组
  const setActiveGroup = useCallback((groupId: string) => {
    animatorRef.current?.setActiveGroup(groupId)
    setConfig(prev => ({ ...prev, activeGroupId: groupId }))
  }, [])
  
  // 添加精灵组
  const addGroup = useCallback((group: SpriteGroup) => {
    setConfig(prev => ({
      ...prev,
      groups: [...prev.groups, group],
    }))
  }, [])
  
  // 更新精灵组
  const updateGroup = useCallback((groupId: string, updates: Partial<SpriteGroup>) => {
    setConfig(prev => ({
      ...prev,
      groups: prev.groups.map(g => g.id === groupId ? { ...g, ...updates } : g),
    }))
  }, [])
  
  // 删除精灵组
  const deleteGroup = useCallback((groupId: string) => {
    setConfig(prev => ({
      ...prev,
      groups: prev.groups.filter(g => g.id !== groupId),
      activeGroupId: prev.activeGroupId === groupId ? undefined : prev.activeGroupId,
    }))
  }, [])
  
  // 添加动画
  const addAnimation = useCallback((animation: SpriteAnimation) => {
    setConfig(prev => ({
      ...prev,
      animations: [...prev.animations, animation],
    }))
  }, [])
  
  // 更新动画
  const updateAnimation = useCallback((animationId: string, updates: Partial<SpriteAnimation>) => {
    setConfig(prev => ({
      ...prev,
      animations: prev.animations.map(a => a.id === animationId ? { ...a, ...updates } : a),
    }))
  }, [])
  
  // 删除动画
  const deleteAnimation = useCallback((animationId: string) => {
    setConfig(prev => ({
      ...prev,
      animations: prev.animations.filter(a => a.id !== animationId),
    }))
  }, [])
  
  // 当前活动组
  const activeGroup = useMemo(() => {
    return config.groups.find(g => g.id === config.activeGroupId)
      || config.groups.find(g => g.isDefault)
      || config.groups[0]
  }, [config.groups, config.activeGroupId])
  
  return (
    <div className="flex flex-col gap-4">
      {/* 精灵显示区域 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Image className="h-4 w-4" />
              {characterName} 精灵
            </CardTitle>
            {!readOnly && (
              <Tabs value={editMode} onValueChange={(v) => setEditMode(v as typeof editMode)}>
                <TabsList className="h-8">
                  <TabsTrigger value="view" className="text-xs px-2">预览</TabsTrigger>
                  <TabsTrigger value="groups" className="text-xs px-2">表情组</TabsTrigger>
                  <TabsTrigger value="animations" className="text-xs px-2">动画</TabsTrigger>
                  <TabsTrigger value="layers" className="text-xs px-2">图层</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* 精灵画布 */}
          <div
            className="relative bg-muted/30 rounded-lg overflow-hidden mx-auto"
            style={{ width: size.width, height: size.height }}
          >
            {renderedLayers.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Image className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无精灵图</p>
                  {!readOnly && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setEditingGroup(null)
                        setShowGroupDialog(true)
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      添加表情组
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              renderedLayers.map((layer) => (
                <img
                  key={layer.id}
                  src={layer.imageUrl}
                  alt={layer.name}
                  className="absolute"
                  style={{
                    zIndex: layer.zIndex,
                    opacity: layer.opacity,
                    transform: `translate(${layer.offset.x}px, ${layer.offset.y}px) scale(${layer.scale.x}, ${layer.scale.y}) rotate(${layer.rotation}deg)`,
                    mixBlendMode: layer.blendMode || 'normal',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              ))
            )}
          </div>
          
          {/* 控制栏 */}
          <div className="mt-3 flex items-center justify-between">
            {/* 表情选择 */}
            <div className="flex items-center gap-2">
              <Label className="text-xs">表情:</Label>
              <Select
                value={activeGroup?.id || ''}
                onValueChange={setActiveGroup}
                disabled={config.groups.length === 0}
              >
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue placeholder="选择表情" />
                </SelectTrigger>
                <SelectContent>
                  {config.groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* 动画控制 */}
            <div className="flex items-center gap-1">
              <Select
                value={currentAnimation || ''}
                onValueChange={playAnimation}
              >
                <SelectTrigger className="w-24 h-8 text-xs">
                  <SelectValue placeholder="动画" />
                </SelectTrigger>
                <SelectContent>
                  {config.animations.map((anim) => (
                    <SelectItem key={anim.id} value={anim.id}>
                      {anim.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {isPlaying ? (
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={stopAnimation}>
                  <Square className="h-3 w-3" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => currentAnimation && playAnimation(currentAnimation)}
                  disabled={!currentAnimation}
                >
                  <Play className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* 编辑面板 */}
      {!readOnly && editMode !== 'view' && (
        <Card>
          <CardContent className="pt-4">
            {editMode === 'groups' && (
              <GroupsEditor
                groups={config.groups}
                activeGroupId={config.activeGroupId}
                onAdd={() => {
                  setEditingGroup(null)
                  setShowGroupDialog(true)
                }}
                onEdit={(group) => {
                  setEditingGroup(group)
                  setShowGroupDialog(true)
                }}
                onDelete={deleteGroup}
                onSetDefault={(groupId) => {
                  setConfig(prev => ({
                    ...prev,
                    groups: prev.groups.map(g => ({
                      ...g,
                      isDefault: g.id === groupId,
                    })),
                  }))
                }}
              />
            )}
            
            {editMode === 'animations' && (
              <AnimationsEditor
                animations={config.animations}
                onAdd={() => {
                  setEditingAnimation(null)
                  setShowAnimationDialog(true)
                }}
                onEdit={(animation) => {
                  setEditingAnimation(animation)
                  setShowAnimationDialog(true)
                }}
                onDelete={deleteAnimation}
                onPlay={playAnimation}
              />
            )}
            
            {editMode === 'layers' && activeGroup && (
              <LayersEditor
                group={activeGroup}
                onAddLayer={() => {
                  setEditingLayer(null)
                  setShowLayerDialog(true)
                }}
                onEditLayer={(layer) => {
                  setEditingLayer({ groupId: activeGroup.id, layer })
                  setShowLayerDialog(true)
                }}
                onDeleteLayer={(layerId) => {
                  updateGroup(activeGroup.id, {
                    layers: activeGroup.layers.filter(l => l.id !== layerId),
                  })
                }}
                onReorderLayer={(layerId, direction) => {
                  const layers = [...activeGroup.layers]
                  const idx = layers.findIndex(l => l.id === layerId)
                  if (idx < 0) return
                  
                  const newIdx = direction === 'up' ? idx - 1 : idx + 1
                  if (newIdx < 0 || newIdx >= layers.length) return
                  
                  [layers[idx], layers[newIdx]] = [layers[newIdx], layers[idx]]
                  // 更新 zIndex
                  layers.forEach((l, i) => l.zIndex = i)
                  updateGroup(activeGroup.id, { layers })
                }}
                onToggleVisibility={(layerId) => {
                  updateGroup(activeGroup.id, {
                    layers: activeGroup.layers.map(l =>
                      l.id === layerId ? { ...l, visible: !l.visible } : l
                    ),
                  })
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
      
      {/* 表情组编辑对话框 */}
      <GroupEditorDialog
        open={showGroupDialog}
        onOpenChange={setShowGroupDialog}
        group={editingGroup}
        onSave={(group) => {
          if (editingGroup) {
            updateGroup(editingGroup.id, group)
          } else {
            addGroup(group as SpriteGroup)
          }
          setShowGroupDialog(false)
        }}
      />
      
      {/* 动画编辑对话框 */}
      <AnimationEditorDialog
        open={showAnimationDialog}
        onOpenChange={setShowAnimationDialog}
        animation={editingAnimation}
        onSave={(animation) => {
          if (editingAnimation) {
            updateAnimation(editingAnimation.id, animation)
          } else {
            addAnimation(animation as SpriteAnimation)
          }
          setShowAnimationDialog(false)
        }}
      />
      
      {/* 图层编辑对话框 */}
      <LayerEditorDialog
        open={showLayerDialog}
        onOpenChange={setShowLayerDialog}
        layer={editingLayer?.layer || null}
        onSave={(layer) => {
          if (editingLayer && activeGroup) {
            updateGroup(activeGroup.id, {
              layers: activeGroup.layers.map(l =>
                l.id === editingLayer.layer.id ? { ...l, ...layer } : l
              ),
            })
          } else if (activeGroup) {
            const newLayer: SpriteLayer = {
              id: `layer-${Date.now()}`,
              name: layer.name || 'New Layer',
              imageUrl: layer.imageUrl || '',
              zIndex: activeGroup.layers.length,
              visible: true,
              opacity: 1,
              offset: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              rotation: 0,
              ...layer,
            }
            updateGroup(activeGroup.id, {
              layers: [...activeGroup.layers, newLayer],
            })
          }
          setShowLayerDialog(false)
        }}
      />
    </div>
  )
}

// ============ 子组件 ============

// 表情组编辑器
function GroupsEditor({
  groups,
  activeGroupId,
  onAdd,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  groups: SpriteGroup[]
  activeGroupId?: string
  onAdd: () => void
  onEdit: (group: SpriteGroup) => void
  onDelete: (groupId: string) => void
  onSetDefault: (groupId: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">表情组管理</Label>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" />
          添加
        </Button>
      </div>
      
      <ScrollArea className="h-48">
        <div className="space-y-2">
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              暂无表情组
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center justify-between p-2 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.layers.length} 图层 · {group.triggers.length} 触发词
                    </p>
                  </div>
                  {group.isDefault && (
                    <Badge variant="secondary" className="text-xs">默认</Badge>
                  )}
                </div>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(group)}>
                      <Edit className="h-3 w-3 mr-2" />
                      编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onSetDefault(group.id)}>
                      <Sparkles className="h-3 w-3 mr-2" />
                      设为默认
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => onDelete(group.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// 动画编辑器
function AnimationsEditor({
  animations,
  onAdd,
  onEdit,
  onDelete,
  onPlay,
}: {
  animations: SpriteAnimation[]
  onAdd: () => void
  onEdit: (animation: SpriteAnimation) => void
  onDelete: (animationId: string) => void
  onPlay: (animationId: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">动画管理</Label>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3 w-3 mr-1" />
          添加
        </Button>
      </div>
      
      <ScrollArea className="h-48">
        <div className="space-y-2">
          {animations.map((animation) => (
            <div
              key={animation.id}
              className="flex items-center justify-between p-2 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{animation.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {animation.duration}ms · {animation.loops === 0 ? '无限循环' : `${animation.loops}次`}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onPlay(animation.id)}
                >
                  <Play className="h-3 w-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(animation)}>
                      <Edit className="h-3 w-3 mr-2" />
                      编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => onDelete(animation.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// 图层编辑器
function LayersEditor({
  group,
  onAddLayer,
  onEditLayer,
  onDeleteLayer,
  onReorderLayer,
  onToggleVisibility,
}: {
  group: SpriteGroup
  onAddLayer: () => void
  onEditLayer: (layer: SpriteLayer) => void
  onDeleteLayer: (layerId: string) => void
  onReorderLayer: (layerId: string, direction: 'up' | 'down') => void
  onToggleVisibility: (layerId: string) => void
}) {
  const sortedLayers = [...group.layers].sort((a, b) => b.zIndex - a.zIndex)
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">图层管理 - {group.name}</Label>
        <Button variant="outline" size="sm" onClick={onAddLayer}>
          <Plus className="h-3 w-3 mr-1" />
          添加图层
        </Button>
      </div>
      
      <ScrollArea className="h-48">
        <div className="space-y-2">
          {sortedLayers.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              暂无图层
            </p>
          ) : (
            sortedLayers.map((layer, idx) => (
              <div
                key={layer.id}
                className="flex items-center justify-between p-2 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onToggleVisibility(layer.id)}
                  >
                    {layer.visible ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                  <div>
                    <p className="text-sm font-medium">{layer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      z:{layer.zIndex} · 透明度:{Math.round(layer.opacity * 100)}%
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onReorderLayer(layer.id, 'up')}
                    disabled={idx === 0}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onReorderLayer(layer.id, 'down')}
                    disabled={idx === sortedLayers.length - 1}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onEditLayer(layer)}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={() => onDeleteLayer(layer.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============ 对话框组件 ============

// 表情组编辑对话框
function GroupEditorDialog({
  open,
  onOpenChange,
  group,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: SpriteGroup | null
  onSave: (group: Partial<SpriteGroup>) => void
}) {
  const [name, setName] = useState('')
  const [triggers, setTriggers] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  
  useEffect(() => {
    if (group) {
      setName(group.name)
      setTriggers(group.triggers.join(', '))
      setImageUrl(group.layers[0]?.imageUrl || '')
    } else {
      setName('')
      setTriggers('')
      setImageUrl('')
    }
  }, [group, open])
  
  const handleSave = () => {
    if (group) {
      onSave({
        name,
        triggers: triggers.split(',').map(t => t.trim()).filter(Boolean),
      })
    } else {
      const newGroup = createDefaultSpriteGroup(
        `group-${Date.now()}`,
        name,
        imageUrl,
        triggers.split(',').map(t => t.trim()).filter(Boolean)
      )
      onSave(newGroup)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? '编辑表情组' : '添加表情组'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 开心、难过、生气"
            />
          </div>
          
          {!group && (
            <div className="space-y-2">
              <Label>图片 URL</Label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="精灵图片地址"
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label>触发词 (逗号分隔)</Label>
            <Input
              value={triggers}
              onChange={(e) => setTriggers(e.target.value)}
              placeholder="happy, smile, 开心, 微笑"
            />
            <p className="text-xs text-muted-foreground">
              消息中包含这些词时会自动切换到此表情
            </p>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!name || (!group && !imageUrl)}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 动画编辑对话框
function AnimationEditorDialog({
  open,
  onOpenChange,
  animation,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  animation: SpriteAnimation | null
  onSave: (animation: Partial<SpriteAnimation>) => void
}) {
  const [name, setName] = useState('')
  const [duration, setDuration] = useState(300)
  const [loops, setLoops] = useState(1)
  const [easing, setEasing] = useState<EasingFunction>('ease-out')
  const [onComplete, setOnComplete] = useState<'reset' | 'hold' | 'reverse'>('reset')
  
  useEffect(() => {
    if (animation) {
      setName(animation.name)
      setDuration(animation.duration)
      setLoops(animation.loops)
      setEasing(animation.easing)
      setOnComplete(animation.onComplete)
    } else {
      setName('')
      setDuration(300)
      setLoops(1)
      setEasing('ease-out')
      setOnComplete('reset')
    }
  }, [animation, open])
  
  const handleSave = () => {
    if (animation) {
      onSave({ name, duration, loops, easing, onComplete })
    } else {
      const newAnimation: SpriteAnimation = {
        id: `anim-${Date.now()}`,
        name,
        duration,
        loops,
        easing,
        onComplete,
        keyframes: [
          { time: 0, properties: { opacity: 1 } },
          { time: 1, properties: { opacity: 1 } },
        ],
      }
      onSave(newAnimation)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{animation ? '编辑动画' : '添加动画'}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="动画名称"
            />
          </div>
          
          <div className="space-y-2">
            <Label>持续时间 (毫秒): {duration}</Label>
            <Slider
              value={[duration]}
              onValueChange={([v]) => setDuration(v)}
              min={100}
              max={5000}
              step={100}
            />
          </div>
          
          <div className="space-y-2">
            <Label>循环次数 (0 = 无限)</Label>
            <Input
              type="number"
              value={loops}
              onChange={(e) => setLoops(parseInt(e.target.value) || 0)}
              min={0}
            />
          </div>
          
          <div className="space-y-2">
            <Label>缓动函数</Label>
            <Select value={easing} onValueChange={(v) => setEasing(v as EasingFunction)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">线性</SelectItem>
                <SelectItem value="ease-in">缓入</SelectItem>
                <SelectItem value="ease-out">缓出</SelectItem>
                <SelectItem value="ease-in-out">缓入缓出</SelectItem>
                <SelectItem value="bounce">弹跳</SelectItem>
                <SelectItem value="elastic">弹性</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>结束行为</Label>
            <Select value={onComplete} onValueChange={(v) => setOnComplete(v as typeof onComplete)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reset">重置</SelectItem>
                <SelectItem value="hold">保持</SelectItem>
                <SelectItem value="reverse">反向</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!name}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 图层编辑对话框
function LayerEditorDialog({
  open,
  onOpenChange,
  layer,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  layer: SpriteLayer | null
  onSave: (layer: Partial<SpriteLayer>) => void
}) {
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [opacity, setOpacity] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [scaleX, setScaleX] = useState(1)
  const [scaleY, setScaleY] = useState(1)
  const [rotation, setRotation] = useState(0)
  
  useEffect(() => {
    if (layer) {
      setName(layer.name)
      setImageUrl(layer.imageUrl)
      setOpacity(layer.opacity)
      setOffsetX(layer.offset.x)
      setOffsetY(layer.offset.y)
      setScaleX(layer.scale.x)
      setScaleY(layer.scale.y)
      setRotation(layer.rotation)
    } else {
      setName('')
      setImageUrl('')
      setOpacity(1)
      setOffsetX(0)
      setOffsetY(0)
      setScaleX(1)
      setScaleY(1)
      setRotation(0)
    }
  }, [layer, open])
  
  const handleSave = () => {
    onSave({
      name,
      imageUrl,
      opacity,
      offset: { x: offsetX, y: offsetY },
      scale: { x: scaleX, y: scaleY },
      rotation,
    })
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{layer ? '编辑图层' : '添加图层'}</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="图层名称"
              />
            </div>
            
            <div className="space-y-2">
              <Label>图片 URL</Label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="图片地址"
              />
            </div>
            
            <div className="space-y-2">
              <Label>透明度: {Math.round(opacity * 100)}%</Label>
              <Slider
                value={[opacity]}
                onValueChange={([v]) => setOpacity(v)}
                min={0}
                max={1}
                step={0.01}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>X 偏移</Label>
                <Input
                  type="number"
                  value={offsetX}
                  onChange={(e) => setOffsetX(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Y 偏移</Label>
                <Input
                  type="number"
                  value={offsetY}
                  onChange={(e) => setOffsetY(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>X 缩放</Label>
                <Input
                  type="number"
                  value={scaleX}
                  onChange={(e) => setScaleX(parseFloat(e.target.value) || 1)}
                  step={0.1}
                />
              </div>
              <div className="space-y-2">
                <Label>Y 缩放</Label>
                <Input
                  type="number"
                  value={scaleY}
                  onChange={(e) => setScaleY(parseFloat(e.target.value) || 1)}
                  step={0.1}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>旋转角度: {rotation}°</Label>
              <Slider
                value={[rotation]}
                onValueChange={([v]) => setRotation(v)}
                min={-180}
                max={180}
                step={1}
              />
            </div>
          </div>
        </ScrollArea>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!name || !imageUrl}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 导出便捷组件 ============

/**
 * 简化的精灵显示组件 (只读)
 */
export function SimpleSpriteDisplay({
  characterId,
  characterName,
  config,
  size = { width: 200, height: 300 },
}: {
  characterId: number
  characterName: string
  config?: SpriteCharacter
  size?: { width: number; height: number }
}) {
  return (
    <SpriteViewer
      characterId={characterId}
      characterName={characterName}
      initialConfig={config}
      readOnly={true}
      size={size}
    />
  )
}

/**
 * 精灵配置面板
 */
export function SpriteConfigPanel({
  characterId,
  characterName,
  config,
  onConfigChange,
}: {
  characterId: number
  characterName: string
  config?: SpriteCharacter
  onConfigChange: (config: SpriteCharacter) => void
}) {
  return (
    <SpriteViewer
      characterId={characterId}
      characterName={characterName}
      initialConfig={config}
      onConfigChange={onConfigChange}
      readOnly={false}
      autoBreathing={false}
    />
  )
}
