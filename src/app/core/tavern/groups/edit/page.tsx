'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { ArrowLeft, Save, Trash2, Plus, X, Users, MessageSquare, GripVertical, Volume2, VolumeX, ChevronUp, ChevronDown } from 'lucide-react'
import { 
  TavernGroup, 
  TavernCard,
  TavernGroupMember,
  GroupCharacterMode,
  getGroupById,
  updateGroup,
  deleteGroup,
  getCards,
  getGroupMembers,
  addGroupMember,
  removeGroupMember,
  updateGroupMember,
} from '@/db/tavern'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { ActivationStrategy } from '@/lib/tavern'

type MemberWithCard = TavernGroupMember & TavernCard

function GroupEditContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const groupId = searchParams.get('id')
  
  const [group, setGroup] = useState<TavernGroup | null>(null)
  const [allCards, setAllCards] = useState<TavernCard[]>([])
  const [members, setMembers] = useState<MemberWithCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  
  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [activationStrategy, setActivationStrategy] = useState<number>(0)
  const [allowSelfResponses, setAllowSelfResponses] = useState(true)
  const [autoTurns, setAutoTurns] = useState(1) // 自动对话轮数
  const [characterMode, setCharacterMode] = useState<number>(GroupCharacterMode.SINGLE)
  const [scenarioOverride, setScenarioOverride] = useState('')
  
  useEffect(() => {
    loadData()
  }, [groupId])
  
  const loadData = async () => {
    if (!groupId) {
      setIsLoading(false)
      return
    }
    
    try {
      const [groupData, cardsData] = await Promise.all([
        getGroupById(parseInt(groupId)),
        getCards()
      ])
      
      if (groupData) {
        setGroup(groupData)
        setName(groupData.name)
        setDescription(groupData.description || '')
        setActivationStrategy(groupData.activationStrategy || 0)
        setAllowSelfResponses(groupData.allowSelfResponses ?? true)
        // 使用 generationType 存储 autoTurns (1-10)
        setAutoTurns(groupData.generationType || 1)
        // 新增字段
        setCharacterMode(groupData.characterMode ?? GroupCharacterMode.SINGLE)
        setScenarioOverride(groupData.scenarioOverride || '')
        
        const membersData = await getGroupMembers(groupData.id)
        // 按 sortOrder 排序
        membersData.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        setMembers(membersData)
      }
      
      setAllCards(cardsData)
    } catch (error) {
      console.error('Failed to load group:', error)
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleSave = async () => {
    if (!groupId || !group) return
    
    setIsSaving(true)
    try {
      await updateGroup(parseInt(groupId), {
        name,
        description,
        activationStrategy,
        allowSelfResponses,
        generationType: autoTurns, // 使用 generationType 存储 autoTurns
        characterMode,
        scenarioOverride,
      })
      toast({ description: '保存成功' })
      router.push('/core/tavern/groups')
    } catch (error) {
      console.error('Failed to save group:', error)
      toast({ description: '保存失败', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleDelete = async () => {
    if (!groupId) return
    
    if (confirm('确定要删除这个群组吗？')) {
      try {
        await deleteGroup(parseInt(groupId))
        router.push('/core/tavern/groups')
      } catch (error) {
        console.error('Failed to delete group:', error)
      }
    }
  }
  
  const handleAddMember = async (cardId: number) => {
    if (!groupId) return
    
    try {
      await addGroupMember({
        groupId: parseInt(groupId),
        cardId,
        isActive: true,
        isMuted: false,
        sortOrder: members.length,
      })
      await loadData()
      setShowAddMember(false)
    } catch (error) {
      console.error('Failed to add member:', error)
    }
  }
  
  const handleRemoveMember = async (memberId: number) => {
    try {
      await removeGroupMember(memberId)
      setMembers(members.filter(m => m.id !== memberId))
      toast({ description: '成员已移除' })
    } catch (error) {
      console.error('Failed to remove member:', error)
      toast({ description: '移除失败', variant: 'destructive' })
    }
  }
  
  // 切换成员激活状态
  const handleToggleMemberActive = async (member: MemberWithCard) => {
    try {
      await updateGroupMember(member.id, { isActive: !member.isActive })
      setMembers(members.map(m => 
        m.id === member.id ? { ...m, isActive: !m.isActive } : m
      ))
    } catch (error) {
      console.error('Failed to toggle member active:', error)
    }
  }
  
  // 切换成员静音状态
  const handleToggleMemberMuted = async (member: MemberWithCard) => {
    try {
      await updateGroupMember(member.id, { isMuted: !member.isMuted })
      setMembers(members.map(m => 
        m.id === member.id ? { ...m, isMuted: !m.isMuted } : m
      ))
    } catch (error) {
      console.error('Failed to toggle member muted:', error)
    }
  }
  
  // 移动成员顺序
  const handleMoveMember = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= members.length) return
    
    const newMembers = [...members]
    const [moved] = newMembers.splice(index, 1)
    newMembers.splice(newIndex, 0, moved)
    
    // 更新 sortOrder
    try {
      await Promise.all(newMembers.map((m, i) => 
        updateGroupMember(m.id, { sortOrder: i })
      ))
      setMembers(newMembers)
    } catch (error) {
      console.error('Failed to reorder members:', error)
    }
  }
  
  const availableCards = allCards.filter(c => !members.some(m => m.cardId === c.id))
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }
  
  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">群组不存在</p>
        <Button onClick={() => router.push('/core/tavern/groups')}>
          返回群组列表
        </Button>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push('/core/tavern/groups')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">编辑群组</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/core/tavern/groups/chat?id=${groupId}`)}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            开始聊天
          </Button>
          <Button variant="destructive" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">群组名称</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入群组名称"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="输入群组描述"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  成员 ({members.length})
                </CardTitle>
                <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      添加成员
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>添加成员</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="max-h-[400px]">
                      <div className="space-y-2">
                        {availableCards.length === 0 ? (
                          <p className="text-center text-muted-foreground py-4">
                            没有可添加的角色卡
                          </p>
                        ) : (
                          availableCards.map((card) => (
                            <div
                              key={card.id}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer"
                              onClick={() => handleAddMember(card.id)}
                            >
                              <Avatar className="h-10 w-10">
                                <AvatarFallback>{card.name[0]}</AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{card.name}</p>
                                <p className="text-sm text-muted-foreground truncate">
                                  {card.description || '无描述'}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  还没有添加成员
                </p>
              ) : (
                <TooltipProvider>
                  <div className="space-y-2">
                    {members.map((member, index) => (
                      <div
                        key={member.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border",
                          !member.isActive && "opacity-50",
                          member.isMuted && "bg-muted/50"
                        )}
                      >
                        {/* 排序按钮 */}
                        <div className="flex flex-col gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleMoveMember(index, 'up')}
                            disabled={index === 0}
                          >
                            <ChevronUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleMoveMember(index, 'down')}
                            disabled={index === members.length - 1}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </div>
                        
                        {/* 头像 */}
                        <Avatar className="h-10 w-10">
                          {member.avatarPath ? (
                            <AvatarImage src={convertFileSrc(member.avatarPath)} />
                          ) : null}
                          <AvatarFallback>{member.name[0]}</AvatarFallback>
                        </Avatar>
                        
                        {/* 名称和状态 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{member.name}</p>
                            {!member.isActive && (
                              <Badge variant="secondary" className="text-xs">禁用</Badge>
                            )}
                            {member.isMuted && (
                              <Badge variant="outline" className="text-xs">静音</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            顺序: {index + 1}
                          </p>
                        </div>
                        
                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleToggleMemberActive(member)}
                              >
                                {member.isActive ? (
                                  <Users className="h-4 w-4" />
                                ) : (
                                  <Users className="h-4 w-4 text-muted-foreground" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {member.isActive ? '禁用成员' : '启用成员'}
                            </TooltipContent>
                          </Tooltip>
                          
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleToggleMemberMuted(member)}
                              >
                                {member.isMuted ? (
                                  <VolumeX className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <Volume2 className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {member.isMuted ? '取消静音' : '静音成员'}
                            </TooltipContent>
                          </Tooltip>
                          
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>高级设置</CardTitle>
              <CardDescription>配置群组对话行为</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 发言策略 */}
              <div className="space-y-2">
                <Label>发言策略</Label>
                <Select
                  value={activationStrategy.toString()}
                  onValueChange={(v) => setActivationStrategy(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ActivationStrategy.Natural.toString()}>
                      自然对话 - AI 根据上下文选择发言者
                    </SelectItem>
                    <SelectItem value={ActivationStrategy.List.toString()}>
                      列表顺序 - 按成员顺序轮流发言
                    </SelectItem>
                    <SelectItem value={ActivationStrategy.Random.toString()}>
                      随机选择 - 随机选择下一个发言者
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* 允许自我回复 */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>允许连续发言</Label>
                  <p className="text-sm text-muted-foreground">
                    同一角色可以连续多次发言
                  </p>
                </div>
                <Switch
                  checked={allowSelfResponses}
                  onCheckedChange={setAllowSelfResponses}
                />
              </div>
              
              {/* 自动对话轮数 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>自动对话轮数</Label>
                    <p className="text-sm text-muted-foreground">
                      用户发送消息后，角色自动对话的轮数
                    </p>
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{autoTurns}</span>
                </div>
                <Slider
                  value={[autoTurns]}
                  onValueChange={([v]) => setAutoTurns(v)}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  设为 1 表示每次只有一个角色回复，设为更高值可让多个角色连续对话
                </p>
              </div>
            </CardContent>
          </Card>
          
          {/* 角色信息模式和场景覆盖 */}
          <Card>
            <CardHeader>
              <CardTitle>上下文设置</CardTitle>
              <CardDescription>配置 AI 生成时的上下文内容</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 角色信息模式 */}
              <div className="space-y-2">
                <Label>角色信息模式</Label>
                <Select
                  value={characterMode.toString()}
                  onValueChange={(v) => setCharacterMode(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GroupCharacterMode.SINGLE.toString()}>
                      单一角色 - 只包含当前发言者的角色信息
                    </SelectItem>
                    <SelectItem value={GroupCharacterMode.JOINT.toString()}>
                      联合模式 - 合并所有成员的角色信息
                    </SelectItem>
                    <SelectItem value={GroupCharacterMode.JOINT_EXCLUDE_MUTED.toString()}>
                      联合排除静音 - 合并非静音成员的角色信息
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  单一模式可减少 token 消耗，联合模式让 AI 更了解所有角色
                </p>
              </div>
              
              {/* 场景覆盖 */}
              <div className="space-y-2">
                <Label htmlFor="scenarioOverride">场景覆盖</Label>
                <Textarea
                  id="scenarioOverride"
                  value={scenarioOverride}
                  onChange={(e) => setScenarioOverride(e.target.value)}
                  placeholder="输入群组共用场景（留空则使用各角色的场景）"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  设置后将覆盖所有成员角色卡中的场景设定。支持 {'{{'}宏{'}}'}  语法。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}

export default function GroupEditPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    }>
      <GroupEditContent />
    </Suspense>
  )
}
