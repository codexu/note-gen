'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Plus,
  Users,
  Search,
  MoreVertical,
  Trash2,
  Settings2,
  MessageSquare,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TavernGroup, TavernCard, getCards } from '@/db/tavern'
import {
  createGroup,
  getGroupWithMembers,
  getGroups,
  deleteGroup,
  ActivationStrategy,
  GroupMemberWithCard,
} from '@/lib/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

export default function GroupsPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  const [groups, setGroups] = useState<TavernGroup[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  
  // 新建群组表单
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [newGroupStrategy, setNewGroupStrategy] = useState<ActivationStrategy>(ActivationStrategy.Natural)

  useEffect(() => {
    loadGroups()
  }, [])

  const loadGroups = async () => {
    setIsLoading(true)
    try {
      const data = await getGroups()
      setGroups(data)
    } catch (error) {
      console.error('加载群组失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast({ description: '请输入群组名称', variant: 'destructive' })
      return
    }

    try {
      const groupId = await createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        activationStrategy: newGroupStrategy,
      })
      
      toast({ description: '群组创建成功' })
      setCreateDialogOpen(false)
      setNewGroupName('')
      setNewGroupDesc('')
      setNewGroupStrategy(ActivationStrategy.Natural)
      
      // 跳转到群组编辑页面
      router.push(`/core/tavern/groups/edit?id=${groupId}`)
    } catch (error) {
      console.error('创建群组失败:', error)
      toast({ description: '创建失败', variant: 'destructive' })
    }
  }

  const handleDeleteGroup = async (group: TavernGroup) => {
    if (!confirm(`确定删除群组 "${group.name}" 吗？`)) return
    
    try {
      await deleteGroup(group.id)
      toast({ description: '删除成功' })
      await loadGroups()
    } catch (error) {
      console.error('删除群组失败:', error)
      toast({ description: '删除失败', variant: 'destructive' })
    }
  }

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getStrategyLabel = (strategy: number) => {
    switch (strategy) {
      case ActivationStrategy.Natural:
        return '自然对话'
      case ActivationStrategy.List:
        return '列表顺序'
      case ActivationStrategy.Random:
        return '随机选择'
      default:
        return '未知'
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">群组聊天</h1>
          <p className="text-sm text-muted-foreground">管理多角色群聊</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          新建群组
        </Button>
      </div>

      {/* 搜索 */}
      <div className="p-4 border-b border-border">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索群组..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* 群组列表 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              加载中...
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg">暂无群组</p>
              <p className="text-sm mt-1">点击新建群组开始多角色聊天</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredGroups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  onEdit={() => router.push(`/core/tavern/groups/edit?id=${group.id}`)}
                  onChat={() => router.push(`/core/tavern/groups/chat?id=${group.id}`)}
                  onDelete={() => handleDeleteGroup(group)}
                  strategyLabel={getStrategyLabel(group.activationStrategy)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 新建群组对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建群组</DialogTitle>
            <DialogDescription>
              创建一个多角色群聊群组
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>群组名称</Label>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="输入群组名称"
              />
            </div>
            
            <div className="space-y-2">
              <Label>群组描述</Label>
              <Textarea
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="描述群组场景或设定（可选）"
                rows={3}
              />
            </div>
            
            <div className="space-y-2">
              <Label>发言策略</Label>
              <Select
                value={newGroupStrategy.toString()}
                onValueChange={(v) => setNewGroupStrategy(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ActivationStrategy.Natural.toString()}>
                    自然对话 - AI 选择下一个发言者
                  </SelectItem>
                  <SelectItem value={ActivationStrategy.List.toString()}>
                    列表顺序 - 按成员顺序轮流
                  </SelectItem>
                  <SelectItem value={ActivationStrategy.Random.toString()}>
                    随机选择 - 随机选择发言者
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateGroup}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 群组卡片组件
interface GroupCardProps {
  group: TavernGroup
  onEdit: () => void
  onChat: () => void
  onDelete: () => void
  strategyLabel: string
}

function GroupCard({ group, onEdit, onChat, onDelete, strategyLabel }: GroupCardProps) {
  const [members, setMembers] = useState<GroupMemberWithCard[]>([])

  useEffect(() => {
    async function loadMembers() {
      const context = await getGroupWithMembers(group.id)
      if (context) {
        setMembers(context.members)
      }
    }
    loadMembers()
  }, [group.id])

  return (
    <div className="border rounded-lg p-4 hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{group.name}</h3>
          {group.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {group.description}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Settings2 className="h-4 w-4 mr-2" />
              编辑群组
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onChat}>
              <MessageSquare className="h-4 w-4 mr-2" />
              开始聊天
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              删除群组
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 成员头像 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex -space-x-2">
          {members.slice(0, 4).map((m) => (
            <Avatar key={m.member.id} className="h-8 w-8 border-2 border-background">
              {m.card.avatarPath ? (
                <AvatarImage src={convertFileSrc(m.card.avatarPath)} />
              ) : null}
              <AvatarFallback className="text-xs">
                {m.card.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
          ))}
          {members.length > 4 && (
            <div className="h-8 w-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs">
              +{members.length - 4}
            </div>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {members.length} 位成员
        </span>
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-xs">
          {strategyLabel}
        </Badge>
        <Button size="sm" onClick={onChat}>
          <MessageSquare className="h-4 w-4 mr-1" />
          聊天
        </Button>
      </div>
    </div>
  )
}
