'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  Settings2,
  Plus,
  Trash2,
  Copy,
  Edit,
  Check,
  ChevronDown,
  Download,
  Upload,
  Link2,
  Unlink,
  Zap,
  Clock,
  BarChart3,
  Sparkles,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  useTavernConnectionProfilesStore,
  ConnectionProfile,
  PROFILE_TEMPLATES,
  createProfileFromAiConfig,
} from '@/stores/tavern-connection-profiles'
import useSettingStore from '@/stores/setting'

// ============ 配置选择器组件 ============

interface ProfileSelectorProps {
  cardId?: number
  compact?: boolean
  onProfileChange?: (profile: ConnectionProfile | null) => void
}

export function ProfileSelector({
  cardId,
  compact = false,
  onProfileChange,
}: ProfileSelectorProps) {
  const {
    profiles,
    activeProfileId,
    setActiveProfile,
    getActiveProfile,
    getCharacterProfile,
    autoSwitchEnabled,
  } = useTavernConnectionProfilesStore()
  
  const [showManager, setShowManager] = useState(false)
  
  // 获取当前应该使用的配置
  const currentProfile = useMemo(() => {
    if (cardId && autoSwitchEnabled) {
      const charProfile = getCharacterProfile(cardId)
      if (charProfile) return charProfile
    }
    return getActiveProfile()
  }, [cardId, autoSwitchEnabled, getCharacterProfile, getActiveProfile, activeProfileId])
  
  const handleSelectProfile = (profileId: string | null) => {
    setActiveProfile(profileId)
    const profile = profileId ? profiles.find(p => p.id === profileId) || null : null
    onProfileChange?.(profile)
  }
  
  if (compact) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>连接配置</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-64" align="end">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">当前配置</Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setShowManager(true)}
              >
                管理
              </Button>
            </div>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                <button
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded text-sm',
                    !currentProfile ? 'bg-primary/10' : 'hover:bg-muted'
                  )}
                  onClick={() => handleSelectProfile(null)}
                >
                  默认配置
                </button>
                {profiles.map(profile => (
                  <button
                    key={profile.id}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2',
                      currentProfile?.id === profile.id ? 'bg-primary/10' : 'hover:bg-muted'
                    )}
                    onClick={() => handleSelectProfile(profile.id)}
                  >
                    {profile.icon && <span>{profile.icon}</span>}
                    <span className="truncate flex-1">{profile.name}</span>
                    {currentProfile?.id === profile.id && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    )
  }
  
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="justify-between min-w-[180px]">
            <span className="flex items-center gap-2 truncate">
              {currentProfile?.icon && <span>{currentProfile.icon}</span>}
              {currentProfile?.name || '默认配置'}
            </span>
            <ChevronDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => handleSelectProfile(null)}>
            <span className="flex items-center gap-2">
              默认配置
              {!currentProfile && <Check className="h-4 w-4 ml-auto" />}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {profiles.map(profile => (
            <DropdownMenuItem
              key={profile.id}
              onClick={() => handleSelectProfile(profile.id)}
            >
              <span className="flex items-center gap-2 flex-1">
                {profile.icon && <span>{profile.icon}</span>}
                <span className="truncate">{profile.name}</span>
                {currentProfile?.id === profile.id && (
                  <Check className="h-4 w-4 ml-auto" />
                )}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowManager(true)}>
            <Settings2 className="h-4 w-4 mr-2" />
            管理配置...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      
      <ProfileManagerDialog
        open={showManager}
        onOpenChange={setShowManager}
        cardId={cardId}
      />
    </>
  )
}

// ============ 配置管理对话框 ============

interface ProfileManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cardId?: number
}

export function ProfileManagerDialog({
  open,
  onOpenChange,
  cardId,
}: ProfileManagerDialogProps) {
  const {
    profiles,
    activeProfileId,
    characterBindings,
    autoSwitchEnabled,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateProfile,
    setActiveProfile,
    bindCharacter,
    unbindCharacter,
    setAutoSwitchEnabled,
    exportProfiles,
    importProfiles,
    getRecentProfiles,
    getMostUsedProfiles,
  } = useTavernConnectionProfilesStore()
  
  const { aiModelList } = useSettingStore()
  
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [view, setView] = useState<'all' | 'recent' | 'most-used'>('all')
  
  const displayProfiles = useMemo(() => {
    switch (view) {
      case 'recent':
        return getRecentProfiles(10)
      case 'most-used':
        return getMostUsedProfiles(10)
      default:
        return profiles
    }
  }, [view, profiles, getRecentProfiles, getMostUsedProfiles])
  
  const currentBinding = cardId
    ? characterBindings.find(b => b.cardId === cardId)
    : null
  
  const handleCreateProfile = () => {
    setEditingProfile(null)
    setShowEditor(true)
  }
  
  const handleEditProfile = (profile: ConnectionProfile) => {
    setEditingProfile(profile)
    setShowEditor(true)
  }
  
  const handleSaveProfile = (data: Partial<ConnectionProfile>) => {
    if (editingProfile) {
      updateProfile(editingProfile.id, data)
      toast({ title: '配置已更新' })
    } else {
      const id = createProfile(data as Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>)
      toast({ title: '配置已创建' })
    }
    setShowEditor(false)
  }
  
  const handleDeleteProfile = (id: string) => {
    deleteProfile(id)
    toast({ title: '配置已删除' })
  }
  
  const handleExport = () => {
    const data = exportProfiles()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `connection-profiles-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: '配置已导出' })
  }
  
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const text = await file.text()
      const result = importProfiles(text)
      
      if (result.success) {
        toast({ title: `已导入 ${result.count} 个配置` })
      } else {
        toast({ title: '导入失败', description: result.error, variant: 'destructive' })
      }
    }
    input.click()
  }
  
  const handleBindCharacter = (profileId: string) => {
    if (!cardId) return
    bindCharacter(cardId, profileId)
    toast({ title: '已绑定到当前角色' })
  }
  
  const handleUnbindCharacter = () => {
    if (!cardId) return
    unbindCharacter(cardId)
    toast({ title: '已解除绑定' })
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showEditor ? (
        <ProfileEditorDialog
          profile={editingProfile}
          onSave={handleSaveProfile}
          onClose={() => setShowEditor(false)}
          aiModelList={aiModelList}
        />
      ) : (
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>连接配置管理</DialogTitle>
            <DialogDescription>
              创建和管理 API 连接配置，支持角色绑定和快速切换
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleCreateProfile}>
                  <Plus className="h-4 w-4 mr-1" />
                  新建
                </Button>
                <Button size="sm" variant="outline" onClick={handleExport}>
                  <Download className="h-4 w-4 mr-1" />
                  导出
                </Button>
                <Button size="sm" variant="outline" onClick={handleImport}>
                  <Upload className="h-4 w-4 mr-1" />
                  导入
                </Button>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={view === 'all' ? 'default' : 'ghost'}
                  onClick={() => setView('all')}
                >
                  全部
                </Button>
                <Button
                  size="sm"
                  variant={view === 'recent' ? 'default' : 'ghost'}
                  onClick={() => setView('recent')}
                >
                  <Clock className="h-3 w-3 mr-1" />
                  最近
                </Button>
                <Button
                  size="sm"
                  variant={view === 'most-used' ? 'default' : 'ghost'}
                  onClick={() => setView('most-used')}
                >
                  <BarChart3 className="h-3 w-3 mr-1" />
                  常用
                </Button>
              </div>
            </div>
            
            {/* 角色绑定设置 */}
            {cardId && (
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  <span className="text-sm">角色绑定</span>
                  {currentBinding && (
                    <Badge variant="secondary">
                      {profiles.find(p => p.id === currentBinding.profileId)?.name}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={autoSwitchEnabled}
                    onCheckedChange={setAutoSwitchEnabled}
                  />
                  <span className="text-xs text-muted-foreground">自动切换</span>
                </div>
              </div>
            )}
            
            {/* 配置列表 */}
            <ScrollArea className="h-[350px]">
              <div className="space-y-2">
                {displayProfiles.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>暂无配置</p>
                    <p className="text-xs">点击“新建”创建配置</p>
                  </div>
                ) : (
                  displayProfiles.map(profile => (
                    <div
                      key={profile.id}
                      className={cn(
                        'flex items-center justify-between p-3 border rounded-lg',
                        activeProfileId === profile.id && 'border-primary bg-primary/5'
                      )}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-2xl">{profile.icon || '⚙️'}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{profile.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {profile.description || `${profile.aiConfigKey} / ${profile.modelId}`}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        {currentBinding?.profileId === profile.id && (
                          <Badge variant="outline" className="text-xs">
                            已绑定
                          </Badge>
                        )}
                        
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => setActiveProfile(profile.id)}
                            >
                              <Zap className={cn(
                                "h-4 w-4",
                                activeProfileId === profile.id && "text-primary"
                              )} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>激活</TooltipContent>
                        </Tooltip>
                        
                        {cardId && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => 
                                  currentBinding?.profileId === profile.id
                                    ? handleUnbindCharacter()
                                    : handleBindCharacter(profile.id)
                                }
                              >
                                {currentBinding?.profileId === profile.id ? (
                                  <Unlink className="h-4 w-4" />
                                ) : (
                                  <Link2 className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {currentBinding?.profileId === profile.id ? '解除绑定' : '绑定角色'}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleEditProfile(profile)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => duplicateProfile(profile.id)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDeleteProfile(profile.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            
            {/* 快速模板 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                快速创建模板
              </Label>
              <div className="flex flex-wrap gap-2">
                {PROFILE_TEMPLATES.map(template => (
                  <Button
                    key={template.name}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const id = createProfile({
                        name: template.name,
                        description: template.description,
                        icon: template.icon,
                        color: template.color,
                        aiConfigKey: aiModelList[0]?.key || '',
                        modelId: aiModelList[0]?.key || '',
                        ...template.defaults,
                      })
                      toast({ title: `已创建 "${template.name}" 配置` })
                    }}
                  >
                    <span className="mr-1">{template.icon}</span>
                    {template.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

// ============ 配置编辑器对话框 ============

interface ProfileEditorDialogProps {
  profile: ConnectionProfile | null
  onSave: (data: Partial<ConnectionProfile>) => void
  onClose: () => void
  aiModelList: any[]
}

function ProfileEditorDialog({
  profile,
  onSave,
  onClose,
  aiModelList,
}: ProfileEditorDialogProps) {
  const [name, setName] = useState(profile?.name || '')
  const [description, setDescription] = useState(profile?.description || '')
  const [icon, setIcon] = useState(profile?.icon || '')
  const [aiConfigKey, setAiConfigKey] = useState(profile?.aiConfigKey || aiModelList[0]?.key || '')
  const [modelId, setModelId] = useState(profile?.modelId || '')
  const [temperature, setTemperature] = useState(profile?.temperature ?? 0.7)
  const [topP, setTopP] = useState(profile?.topP ?? 0.9)
  const [maxTokens, setMaxTokens] = useState(profile?.maxTokens || 0)
  const [enableStream, setEnableStream] = useState(profile?.enableStream ?? true)
  const [apiKeyOverride, setApiKeyOverride] = useState(profile?.apiKeyOverride || '')
  const [baseURLOverride, setBaseURLOverride] = useState(profile?.baseURLOverride || '')
  
  const selectedConfig = aiModelList.find(c => c.key === aiConfigKey)
  const availableModels = selectedConfig?.models || []
  
  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: '请输入配置名称', variant: 'destructive' })
      return
    }
    
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon || undefined,
      aiConfigKey,
      modelId: modelId || aiConfigKey,
      temperature,
      topP,
      maxTokens: maxTokens || undefined,
      enableStream,
      apiKeyOverride: apiKeyOverride || undefined,
      baseURLOverride: baseURLOverride || undefined,
    })
  }
  
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{profile ? '编辑配置' : '新建配置'}</DialogTitle>
      </DialogHeader>
      
      <div className="space-y-4 py-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-1">
            <Label>图标</Label>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="✨"
              className="text-center text-xl"
            />
          </div>
          <div className="col-span-3">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的配置"
            />
          </div>
        </div>
        
        <div>
          <Label>描述</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="配置描述 (可选)"
            rows={2}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>AI 服务</Label>
            <Select value={aiConfigKey} onValueChange={(v) => {
              setAiConfigKey(v)
              setModelId('')
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aiModelList.map(config => (
                  <SelectItem key={config.key} value={config.key}>
                    {config.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label>模型</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger>
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model: any) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.model || model.id}
                  </SelectItem>
                ))}
                {availableModels.length === 0 && (
                  <SelectItem value={aiConfigKey}>默认</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Temperature</Label>
              <span className="text-sm text-muted-foreground">{temperature}</span>
            </div>
            <Slider
              value={[temperature]}
              onValueChange={([v]) => setTemperature(v)}
              min={0}
              max={2}
              step={0.1}
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Top P</Label>
              <span className="text-sm text-muted-foreground">{topP}</span>
            </div>
            <Slider
              value={[topP]}
              onValueChange={([v]) => setTopP(v)}
              min={0}
              max={1}
              step={0.05}
            />
          </div>
          
          <div>
            <Label>Max Tokens (0=默认)</Label>
            <Input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 0)}
              min={0}
            />
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <Label>启用流式输出</Label>
          <Switch checked={enableStream} onCheckedChange={setEnableStream} />
        </div>
        
        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs text-muted-foreground">高级覆盖 (可选)</Label>
          <Input
            value={apiKeyOverride}
            onChange={(e) => setApiKeyOverride(e.target.value)}
            placeholder="API Key 覆盖"
            type="password"
          />
          <Input
            value={baseURLOverride}
            onChange={(e) => setBaseURLOverride(e.target.value)}
            placeholder="Base URL 覆盖"
          />
        </div>
      </div>
      
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={handleSave}>保存</Button>
      </DialogFooter>
    </DialogContent>
  )
}
