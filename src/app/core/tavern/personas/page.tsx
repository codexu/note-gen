'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ArrowLeft, Plus, Trash2, Star, User, BookOpen, Link2, X } from 'lucide-react'
import { 
  TavernPersona, 
  TavernWorldInfo,
  TavernCard,
  getPersonas, 
  insertPersona, 
  updatePersona, 
  deletePersona,
  setDefaultPersona,
  getWorldInfos,
  getCards,
} from '@/db/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Settings2 } from 'lucide-react'
import {
  PersonaDescriptionPosition,
  PersonaDescriptionRole,
  PersonaPositionLabels,
  PersonaRoleLabels,
  parsePersonaConnections,
  type PersonaDescriptionPositionType,
  type PersonaDescriptionRoleType,
  type PersonaConnection,
} from '@/lib/tavern/persona-types'
import {
  addPersonaConnection,
  removePersonaConnection,
} from '@/lib/tavern/persona-lock'
import { useTavernPersonaSettingsStore } from '@/stores/tavern-persona-settings'

// 编辑表单类型
interface EditFormState {
  name: string
  description: string
  position: PersonaDescriptionPositionType
  depth: number
  role: PersonaDescriptionRoleType
  lorebook: string
}

export default function PersonasPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [personas, setPersonas] = useState<TavernPersona[]>([])
  const [showSettings, setShowSettings] = useState(false)
  
  // 全局设置
  const {
    showNotifications,
    allowMultiConnections,
    autoLock,
    sortOrder,
    updateSetting,
  } = useTavernPersonaSettingsStore()
  const [worldInfos, setWorldInfos] = useState<TavernWorldInfo[]>([])
  const [cards, setCards] = useState<TavernCard[]>([])
  const [selectedPersona, setSelectedPersona] = useState<TavernPersona | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({
    name: '',
    description: '',
    position: PersonaDescriptionPosition.IN_PROMPT,
    depth: 2,
    role: PersonaDescriptionRole.SYSTEM,
    lorebook: '',
  })

  // 加载用户设定列表和世界书列表
  useEffect(() => {
    loadPersonas()
    loadWorldInfos()
    loadCards()
  }, [])

  const loadPersonas = async () => {
    const data = await getPersonas()
    setPersonas(data)
    if (data.length > 0 && !selectedPersona) {
      setSelectedPersona(data.find(p => p.isDefault) || data[0])
    }
  }

  const loadWorldInfos = async () => {
    const data = await getWorldInfos()
    setWorldInfos(data)
  }

  const loadCards = async () => {
    const data = await getCards()
    setCards(data)
  }

  // 解析当前 Persona 的连接
  const currentConnections = useMemo(() => {
    if (!selectedPersona) return []
    return parsePersonaConnections(selectedPersona.connections || '[]')
  }, [selectedPersona])

  // 排序后的 Persona 列表
  const sortedPersonas = useMemo(() => {
    return [...personas].sort((a, b) => {
      const nameA = a.name.toLowerCase()
      const nameB = b.name.toLowerCase()
      if (sortOrder === 'asc') {
        return nameA.localeCompare(nameB)
      } else {
        return nameB.localeCompare(nameA)
      }
    })
  }, [personas, sortOrder])

  // 获取连接的角色卡名称
  const getConnectedCardName = (connection: PersonaConnection) => {
    if (connection.type === 'character') {
      const card = cards.find(c => c.id === connection.id)
      return card?.name || `角色 #${connection.id}`
    }
    return `群组 #${connection.id}`
  }

  // 添加角色绑定
  const handleAddConnection = async (cardId: number) => {
    if (!selectedPersona) return
    await addPersonaConnection(selectedPersona.id, { type: 'character', id: cardId })
    // 重新加载并更新选中的 Persona
    const data = await getPersonas()
    setPersonas(data)
    const updated = data.find(p => p.id === selectedPersona.id)
    if (updated) setSelectedPersona(updated)
    toast({ title: '已绑定角色' })
  }

  // 移除角色绑定
  const handleRemoveConnection = async (connection: PersonaConnection) => {
    if (!selectedPersona) return
    await removePersonaConnection(selectedPersona.id, connection.type, connection.id)
    // 重新加载并更新选中的 Persona
    const data = await getPersonas()
    setPersonas(data)
    const updated = data.find(p => p.id === selectedPersona.id)
    if (updated) setSelectedPersona(updated)
    toast({ title: '已解除绑定' })
  }

  // 从 Persona 初始化编辑表单
  const initEditForm = (persona: TavernPersona) => {
    setEditForm({
      name: persona.name,
      description: persona.description,
      position: (persona.position ?? PersonaDescriptionPosition.IN_PROMPT) as PersonaDescriptionPositionType,
      depth: persona.depth ?? 2,
      role: (persona.role ?? PersonaDescriptionRole.SYSTEM) as PersonaDescriptionRoleType,
      lorebook: persona.lorebook ?? '',
    })
  }

  // 创建新用户设定
  const handleCreate = async () => {
    const id = await insertPersona({
      name: '新用户',
      description: '',
      avatarPath: '',
      isDefault: personas.length === 0,
      position: PersonaDescriptionPosition.IN_PROMPT,
      depth: 2,
      role: PersonaDescriptionRole.SYSTEM,
      lorebook: '',
      connections: '[]',
    })
    await loadPersonas()
    const newPersona = personas.find(p => p.id === id)
    if (newPersona) {
      setSelectedPersona(newPersona)
      initEditForm(newPersona)
      setIsEditing(true)
    }
  }

  // 保存编辑
  const handleSave = async () => {
    if (!selectedPersona) return
    await updatePersona(selectedPersona.id, {
      name: editForm.name,
      description: editForm.description,
      position: editForm.position,
      depth: editForm.depth,
      role: editForm.role,
      lorebook: editForm.lorebook,
    })
    await loadPersonas()
    setIsEditing(false)
    toast({ title: '保存成功' })
  }

  // 删除用户设定
  const handleDelete = async (id: number) => {
    await deletePersona(id)
    await loadPersonas()
    if (selectedPersona?.id === id) {
      setSelectedPersona(personas[0] || null)
    }
    toast({ title: '已删除' })
  }

  // 设为默认
  const handleSetDefault = async (id: number) => {
    await setDefaultPersona(id)
    await loadPersonas()
    toast({ title: '已设为默认' })
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">用户设定</h1>
          <p className="text-sm text-muted-foreground">管理您在对话中的角色身份</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowSettings(!showSettings)}
          className={cn(showSettings && 'bg-accent')}
        >
          <Settings2 className="h-5 w-5" />
        </Button>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建
        </Button>
      </div>

      {/* 全局设置面板 */}
      {showSettings && (
        <div className="border-b border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">全局设置</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowSettings(false)}
            >
              收起
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="showNotifications" className="text-sm">
                显示通知
              </Label>
              <Switch
                id="showNotifications"
                checked={showNotifications}
                onCheckedChange={(v) => updateSetting('showNotifications', v)}
              />
            </div>
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="autoLock" className="text-sm">
                自动锁定
              </Label>
              <Switch
                id="autoLock"
                checked={autoLock}
                onCheckedChange={(v) => updateSetting('autoLock', v)}
              />
            </div>
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="allowMulti" className="text-sm">
                多连接选择
              </Label>
              <Switch
                id="allowMulti"
                checked={allowMultiConnections}
                onCheckedChange={(v) => updateSetting('allowMultiConnections', v)}
              />
            </div>
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="sortOrder" className="text-sm">
                排序
              </Label>
              <Select
                value={sortOrder}
                onValueChange={(v: 'asc' | 'desc') => updateSetting('sortOrder', v)}
              >
                <SelectTrigger className="h-7 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">升序</SelectItem>
                  <SelectItem value="desc">降序</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            自动锁定：选择 Persona 时自动锁定到当前聊天 | 多连接选择：当多个 Persona 绑定同一角色时弹窗选择
          </p>
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧列表 */}
        <div className="w-64 border-r border-border">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-1">
              {sortedPersonas.map((persona) => {
                const connections = parsePersonaConnections(persona.connections || '[]')
                const hasConnections = connections.length > 0
                
                return (
                  <button
                    key={persona.id}
                    onClick={() => {
                      setSelectedPersona(persona)
                      initEditForm(persona)
                      setIsEditing(false)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
                      'hover:bg-accent/50',
                      selectedPersona?.id === persona.id && 'bg-accent'
                    )}
                  >
                    <Avatar className="h-10 w-10">
                      {persona.avatarPath ? (
                        <AvatarImage src={convertFileSrc(persona.avatarPath)} />
                      ) : null}
                      <AvatarFallback>
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{persona.name}</span>
                        {/* 状态图标 */}
                        <TooltipProvider>
                          {persona.isDefault && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>默认 Persona</TooltipContent>
                            </Tooltip>
                          )}
                          {hasConnections && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                已绑定 {connections.length} 个角色
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TooltipProvider>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {persona.description || '暂无描述'}
                      </p>
                    </div>
                  </button>
                )
              })}
              {personas.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无用户设定</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧详情 */}
        <div className="flex-1 p-6">
          {selectedPersona ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{isEditing ? '编辑用户设定' : selectedPersona.name}</span>
                  <div className="flex gap-2">
                    {!selectedPersona.isDefault && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleSetDefault(selectedPersona.id)}
                      >
                        设为默认
                      </Button>
                    )}
                    {!isEditing ? (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          initEditForm(selectedPersona)
                          setIsEditing(true)
                        }}
                      >
                        编辑
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleSave}>
                        保存
                      </Button>
                    )}
                    {!selectedPersona.isDefault && (
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => handleDelete(selectedPersona.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardTitle>
                <CardDescription>
                  此设定将用于 AI 对话中代表您的身份
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing ? (
                  <>
                    <div>
                      <Label>名称</Label>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="您的名称"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>描述</Label>
                      <Textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="描述您的角色背景、性格等..."
                        className="mt-1 min-h-[150px]"
                      />
                    </div>
                    
                    {/* 注入位置选择 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>注入位置</Label>
                        <Select
                          value={String(editForm.position)}
                          onValueChange={(v) => setEditForm({ ...editForm, position: Number(v) as PersonaDescriptionPositionType })}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PersonaPositionLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label>角色</Label>
                        <Select
                          value={String(editForm.role)}
                          onValueChange={(v) => setEditForm({ ...editForm, role: Number(v) as PersonaDescriptionRoleType })}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PersonaRoleLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    {/* 深度输入 (AT_DEPTH 时显示) */}
                    {editForm.position === PersonaDescriptionPosition.AT_DEPTH && (
                      <div>
                        <Label>注入深度</Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={editForm.depth}
                          onChange={(e) => setEditForm({ ...editForm, depth: Number(e.target.value) })}
                          className="mt-1 w-32"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          0 表示最新消息之前，数字越大越靠后
                        </p>
                      </div>
                    )}
                    
                    {/* 关联世界书 */}
                    <div>
                      <Label className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        关联世界书
                      </Label>
                      <Select
                        value={editForm.lorebook || '_none'}
                        onValueChange={(v) => setEditForm({ ...editForm, lorebook: v === '_none' ? '' : v })}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="选择世界书" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">无</SelectItem>
                          {worldInfos.map((wi) => (
                            <SelectItem key={wi.id} value={wi.name}>{wi.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        关联的世界书将在使用此 Persona 时自动加载
                      </p>
                    </div>
                    
                    {/* 角色绑定 */}
                    <div>
                      <Label className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        角色绑定
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1 mb-2">
                        绑定后，打开该角色时会自动使用此 Persona
                      </p>
                      
                      {/* 已绑定角色列表 */}
                      {currentConnections.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {currentConnections.map((conn, idx) => (
                            <Badge key={idx} variant="secondary" className="flex items-center gap-1">
                              {getConnectedCardName(conn)}
                              <button
                                onClick={() => handleRemoveConnection(conn)}
                                className="ml-1 hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      {/* 添加绑定 */}
                      <Select
                        value="_add"
                        onValueChange={(v) => {
                          if (v !== '_add') {
                            handleAddConnection(Number(v))
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="添加角色绑定..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_add" disabled>选择角色...</SelectItem>
                          {cards
                            .filter(card => !currentConnections.some(c => c.type === 'character' && c.id === card.id))
                            .map((card) => (
                              <SelectItem key={card.id} value={String(card.id)}>
                                {card.name}
                              </SelectItem>
                            ))
                          }
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label className="text-muted-foreground">描述</Label>
                      <p className="mt-1 whitespace-pre-wrap">
                        {selectedPersona.description || '暂无描述'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-muted-foreground">注入位置</Label>
                        <p className="mt-1">
                          {PersonaPositionLabels[selectedPersona.position as PersonaDescriptionPositionType] || '在提示词中'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">角色</Label>
                        <p className="mt-1">
                          {PersonaRoleLabels[selectedPersona.role as PersonaDescriptionRoleType] || '系统'}
                        </p>
                      </div>
                    </div>
                    {selectedPersona.position === PersonaDescriptionPosition.AT_DEPTH && (
                      <div className="text-sm">
                        <Label className="text-muted-foreground">注入深度</Label>
                        <p className="mt-1">{selectedPersona.depth ?? 2}</p>
                      </div>
                    )}
                    {selectedPersona.lorebook && (
                      <div className="text-sm">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <BookOpen className="h-4 w-4" />
                          关联世界书
                        </Label>
                        <p className="mt-1">{selectedPersona.lorebook}</p>
                      </div>
                    )}
                    {currentConnections.length > 0 && (
                      <div className="text-sm">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          绑定角色
                        </Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {currentConnections.map((conn, idx) => (
                            <Badge key={idx} variant="secondary">
                              {getConnectedCardName(conn)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              选择或创建一个用户设定
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
