'use client'

import { useState, useCallback } from 'react'
import {
  useTavernTTSStore,
  CharacterVoiceConfig,
  VoicePreset,
  AVAILABLE_VOICES,
  BUILT_IN_PRESETS,
} from '@/stores/tavern-tts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  Volume2,
  Play,
  Pause,
  Settings2,
  Plus,
  Trash2,
  Check,
  Save,
  MoreHorizontal,
  Download,
  Upload,
  Mic,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ============ 角色声音配置器 ============
interface CharacterVoiceConfiguratorProps {
  cardId: number
  characterName?: string
  onClose?: () => void
  compact?: boolean
}

export function CharacterVoiceConfigurator({
  cardId,
  characterName,
  onClose,
  compact = false,
}: CharacterVoiceConfiguratorProps) {
  const { toast } = useToast()
  const {
    characterVoices,
    voicePresets,
    setCharacterVoice,
    clearCharacterVoice,
    applyPresetToCharacter,
  } = useTavernTTSStore()
  
  const existingConfig = characterVoices[cardId]
  const [config, setConfig] = useState<CharacterVoiceConfig>(
    existingConfig || {
      voice: 'alloy',
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
    }
  )
  const [isPlaying, setIsPlaying] = useState(false)
  
  const handleSave = () => {
    setCharacterVoice(cardId, config)
    toast({ description: '声音配置已保存' })
    onClose?.()
  }
  
  const handleClear = () => {
    clearCharacterVoice(cardId)
    toast({ description: '已清除角色声音配置' })
    onClose?.()
  }
  
  const handlePreviewVoice = async () => {
    // 这里可以集成实际的 TTS 预览功能
    setIsPlaying(true)
    toast({ description: `正在预览 ${config.voice} 音色...` })
    setTimeout(() => setIsPlaying(false), 2000)
  }
  
  const allPresets = [...BUILT_IN_PRESETS, ...voicePresets]
  
  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Volume2 className="h-3.5 w-3.5" />
            {existingConfig ? existingConfig.voice : '设置声音'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4" align="start">
          <VoiceConfigForm
            config={config}
            onChange={setConfig}
            onSave={handleSave}
            onClear={existingConfig ? handleClear : undefined}
            onPreview={handlePreviewVoice}
            isPlaying={isPlaying}
            presets={allPresets}
            onApplyPreset={(preset) => {
              setConfig({ ...config, ...preset.config })
            }}
          />
        </PopoverContent>
      </Popover>
    )
  }
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Volume2 className="h-4 w-4" />
          {characterName ? `${characterName} 的声音` : '角色声音配置'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VoiceConfigForm
          config={config}
          onChange={setConfig}
          onSave={handleSave}
          onClear={existingConfig ? handleClear : undefined}
          onPreview={handlePreviewVoice}
          isPlaying={isPlaying}
          presets={allPresets}
          onApplyPreset={(preset) => {
            setConfig({ ...config, ...preset.config })
          }}
        />
      </CardContent>
    </Card>
  )
}

// ============ 声音配置表单 ============
interface VoiceConfigFormProps {
  config: CharacterVoiceConfig
  onChange: (config: CharacterVoiceConfig) => void
  onSave: () => void
  onClear?: () => void
  onPreview: () => void
  isPlaying: boolean
  presets: (VoicePreset | Omit<VoicePreset, 'id'>)[]
  onApplyPreset: (preset: VoicePreset | Omit<VoicePreset, 'id'>) => void
}

function VoiceConfigForm({
  config,
  onChange,
  onSave,
  onClear,
  onPreview,
  isPlaying,
  presets,
  onApplyPreset,
}: VoiceConfigFormProps) {
  return (
    <div className="space-y-4">
      {/* 音色选择 */}
      <div className="space-y-2">
        <Label className="text-sm">音色</Label>
        <Select
          value={config.voice}
          onValueChange={(v) => onChange({ ...config, voice: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_VOICES.map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                <div className="flex items-center justify-between w-full">
                  <span>{voice.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
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
          <span className="text-xs text-muted-foreground">{config.speed.toFixed(2)}x</span>
        </div>
        <Slider
          value={[config.speed]}
          onValueChange={([v]) => onChange({ ...config, speed: v })}
          min={0.5}
          max={2.0}
          step={0.05}
        />
      </div>
      
      {/* 音调 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">音调</Label>
          <span className="text-xs text-muted-foreground">{(config.pitch ?? 1.0).toFixed(2)}</span>
        </div>
        <Slider
          value={[config.pitch ?? 1.0]}
          onValueChange={([v]) => onChange({ ...config, pitch: v })}
          min={0.5}
          max={2.0}
          step={0.05}
        />
      </div>
      
      {/* 预设 */}
      <div className="space-y-2">
        <Label className="text-sm">快速预设</Label>
        <div className="flex flex-wrap gap-1">
          {presets.slice(0, 6).map((preset, i) => (
            <Button
              key={preset.name}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onApplyPreset(preset)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>
      
      {/* 操作按钮 */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onPreview}
          disabled={isPlaying}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 mr-1" />
          ) : (
            <Play className="h-4 w-4 mr-1" />
          )}
          预览
        </Button>
        <Button size="sm" className="flex-1" onClick={onSave}>
          <Save className="h-4 w-4 mr-1" />
          保存
        </Button>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onClear}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ============ 声音预设管理对话框 ============
interface VoicePresetManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VoicePresetManager({ open, onOpenChange }: VoicePresetManagerProps) {
  const { toast } = useToast()
  const {
    voicePresets,
    addVoicePreset,
    updateVoicePreset,
    deleteVoicePreset,
    exportVoiceSettings,
    importVoiceSettings,
  } = useTavernTTSStore()
  
  const [editingPreset, setEditingPreset] = useState<VoicePreset | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  
  const allPresets = [...BUILT_IN_PRESETS.map((p, i) => ({ ...p, id: `builtin_${i}` })), ...voicePresets]
  
  const handleExport = () => {
    const data = exportVoiceSettings()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voice-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const text = await file.text()
      const result = importVoiceSettings(text)
      
      if (result.success) {
        toast({ description: '声音设置已导入' })
      } else {
        toast({ description: `导入失败: ${result.error}`, variant: 'destructive' })
      }
    }
    input.click()
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              声音预设管理
            </DialogTitle>
          </DialogHeader>
          
          {/* 工具栏 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              新建预设
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={handleImport}>
              <Upload className="h-4 w-4 mr-1" />
              导入
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />
              导出
            </Button>
          </div>
          
          {/* 预设列表 */}
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {allPresets.map((preset) => {
                const isBuiltIn = preset.id.startsWith('builtin_')
                const voice = AVAILABLE_VOICES.find(v => v.id === preset.config.voice)
                
                return (
                  <div
                    key={preset.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
                  >
                    <Volume2 className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{preset.name}</span>
                        {isBuiltIn && (
                          <Badge variant="secondary" className="text-[10px]">内置</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        <span>{voice?.name || preset.config.voice}</span>
                        <span>速度 {preset.config.speed}x</span>
                      </div>
                    </div>
                    {preset.tags && preset.tags.length > 0 && (
                      <div className="flex gap-1">
                        {preset.tags.map(tag => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {!isBuiltIn && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingPreset(preset)}>
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              if (confirm(`确定删除预设 "${preset.name}"？`)) {
                                deleteVoicePreset(preset.id)
                              }
                            }}
                          >
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      
      {/* 创建/编辑预设对话框 */}
      {(showCreateDialog || editingPreset) && (
        <PresetEditorDialog
          preset={editingPreset}
          open={showCreateDialog || !!editingPreset}
          onOpenChange={(open) => {
            if (!open) {
              setShowCreateDialog(false)
              setEditingPreset(null)
            }
          }}
          onSave={(data) => {
            if (editingPreset) {
              updateVoicePreset(editingPreset.id, data)
            } else {
              addVoicePreset(data)
            }
            setShowCreateDialog(false)
            setEditingPreset(null)
          }}
        />
      )}
    </>
  )
}

// ============ 预设编辑器对话框 ============
interface PresetEditorDialogProps {
  preset?: VoicePreset | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Omit<VoicePreset, 'id'>) => void
}

function PresetEditorDialog({
  preset,
  open,
  onOpenChange,
  onSave,
}: PresetEditorDialogProps) {
  const [name, setName] = useState(preset?.name || '')
  const [description, setDescription] = useState(preset?.description || '')
  const [config, setConfig] = useState<CharacterVoiceConfig>(
    preset?.config || { voice: 'alloy', speed: 1.0, pitch: 1.0 }
  )
  const [tags, setTags] = useState(preset?.tags?.join(', ') || '')
  
  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim(),
      config,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    onOpenChange(false)
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{preset ? '编辑预设' : '新建预设'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="预设名称"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选描述"
            />
          </div>
          <div className="space-y-2">
            <Label>音色</Label>
            <Select
              value={config.voice}
              onValueChange={(v) => setConfig({ ...config, voice: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_VOICES.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>语速</Label>
                <span className="text-xs text-muted-foreground">{config.speed}x</span>
              </div>
              <Slider
                value={[config.speed]}
                onValueChange={([v]) => setConfig({ ...config, speed: v })}
                min={0.5}
                max={2.0}
                step={0.1}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>音调</Label>
                <span className="text-xs text-muted-foreground">{config.pitch ?? 1.0}</span>
              </div>
              <Slider
                value={[config.pitch ?? 1.0]}
                onValueChange={([v]) => setConfig({ ...config, pitch: v })}
                min={0.5}
                max={2.0}
                step={0.1}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>标签（逗号分隔）</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="女性, 温柔"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 群聊声音配置器 ============
interface GroupChatVoiceConfiguratorProps {
  chatId: number
  characters: string[]
  onClose?: () => void
}

export function GroupChatVoiceConfigurator({
  chatId,
  characters,
  onClose,
}: GroupChatVoiceConfiguratorProps) {
  const { toast } = useToast()
  const {
    groupChatMappings,
    setGroupChatVoice,
    clearGroupChatVoices,
  } = useTavernTTSStore()
  
  const mapping = groupChatMappings[chatId]
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            群聊声音配置
          </span>
          {mapping && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                clearGroupChatVoices(chatId)
                toast({ description: '已清除群聊声音配置' })
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {characters.map((character) => {
            const voiceConfig = mapping?.characterVoices[character]
            return (
              <div key={character} className="flex items-center justify-between">
                <span className="text-sm font-medium">{character}</span>
                <CharacterVoiceQuickSelect
                  value={voiceConfig}
                  onChange={(config) => {
                    if (config) {
                      setGroupChatVoice(chatId, character, config)
                    }
                  }}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 快速声音选择 ============
interface CharacterVoiceQuickSelectProps {
  value?: CharacterVoiceConfig
  onChange: (config: CharacterVoiceConfig | null) => void
}

function CharacterVoiceQuickSelect({ value, onChange }: CharacterVoiceQuickSelectProps) {
  const voice = AVAILABLE_VOICES.find(v => v.id === value?.voice)
  
  return (
    <Select
      value={value?.voice || ''}
      onValueChange={(v) => {
        if (v) {
          onChange({ voice: v, speed: 1.0 })
        }
      }}
    >
      <SelectTrigger className="w-32 h-8">
        <SelectValue placeholder="选择声音" />
      </SelectTrigger>
      <SelectContent>
        {AVAILABLE_VOICES.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
