'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  useTavernTagsStore,
  Tag,
  TagGroup,
  TagCategory,
  TagColor,
  TAG_COLORS,
  getRandomTagColor,
  getTagUsageStats,
  searchTags,
  sortTagsByUsage,
} from '@/stores/tavern-tags'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import {
  Tag as TagIcon,
  Plus,
  X,
  Edit,
  Trash2,
  Search,
  MoreHorizontal,
  Download,
  Import,
  Check,
  ChevronDown,
  FolderOpen,
  Users,
  MessageSquare,
  Globe,
  Paperclip,
  Hash,
} from 'lucide-react'

// ============ 标签选择器 ============
interface TagSelectorProps {
  entityType: 'character' | 'chat' | 'worldInfo' | 'attachment'
  entityId: string | number
  className?: string
}

export function TagSelector({
  entityType,
  entityId,
  className,
}: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  
  const { tags, getTagsForEntity, associateTag, dissociateTag, addTag } = useTavernTagsStore()
  
  const entityTags = getTagsForEntity(entityType, entityId)
  const entityTagIds = entityTags.map(t => t.id)
  
  const filteredTags = searchQuery
    ? searchTags(tags, searchQuery)
    : tags
  
  const handleToggleTag = (tagId: string) => {
    if (entityTagIds.includes(tagId)) {
      dissociateTag(tagId, entityType, entityId)
    } else {
      associateTag(tagId, entityType, entityId)
    }
  }
  
  const handleCreateTag = () => {
    if (!searchQuery.trim()) return
    const id = addTag({
      name: searchQuery.trim(),
      color: getRandomTagColor(),
      category: entityType === 'worldInfo' ? 'world-info' : entityType as TagCategory,
    })
    associateTag(id, entityType, entityId)
    setSearchQuery('')
  }
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-8 gap-1', className)}
        >
          <TagIcon className="h-3.5 w-3.5" />
          {entityTags.length > 0 ? (
            <span className="text-xs">{entityTags.length} 标签</span>
          ) : (
            <span className="text-xs text-muted-foreground">添加标签</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="搜索或创建标签..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>
              {searchQuery ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={handleCreateTag}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  创建 “{searchQuery}”
                </Button>
              ) : (
                <span className="text-muted-foreground text-sm p-2">无标签</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {filteredTags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  onSelect={() => handleToggleTag(tag.id)}
                  className="flex items-center gap-2"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1">{tag.name}</span>
                  {entityTagIds.includes(tag.id) && (
                    <Check className="h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ============ 标签显示 ============
interface TagBadgesProps {
  entityType: 'character' | 'chat' | 'worldInfo' | 'attachment'
  entityId: string | number
  maxDisplay?: number
  size?: 'sm' | 'md'
  editable?: boolean
  className?: string
}

export function TagBadges({
  entityType,
  entityId,
  maxDisplay = 3,
  size = 'sm',
  editable = false,
  className,
}: TagBadgesProps) {
  const { getTagsForEntity, dissociateTag } = useTavernTagsStore()
  
  const entityTags = getTagsForEntity(entityType, entityId)
  const displayTags = entityTags.slice(0, maxDisplay)
  const remainingCount = entityTags.length - maxDisplay
  
  if (entityTags.length === 0) return null
  
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {displayTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="secondary"
          className={cn(
            'gap-1',
            size === 'sm' ? 'text-[10px] h-5 px-1.5' : 'text-xs h-6 px-2'
          )}
          style={{
            backgroundColor: `${tag.color}20`,
            borderColor: tag.color,
            color: tag.color,
          }}
        >
          {tag.name}
          {editable && (
            <X
              className={cn(
                'cursor-pointer hover:opacity-70',
                size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'
              )}
              onClick={(e) => {
                e.stopPropagation()
                dissociateTag(tag.id, entityType, entityId)
              }}
            />
          )}
        </Badge>
      ))}
      {remainingCount > 0 && (
        <Badge
          variant="outline"
          className={cn(
            size === 'sm' ? 'text-[10px] h-5 px-1.5' : 'text-xs h-6 px-2'
          )}
        >
          +{remainingCount}
        </Badge>
      )}
    </div>
  )
}

// ============ 标签筛选器 ============
interface TagFilterProps {
  entityType: 'character' | 'chat' | 'worldInfo' | 'attachment'
  selectedTags: string[]
  onTagsChange: (tagIds: string[]) => void
  filterMode: 'any' | 'all' | 'none'
  onFilterModeChange: (mode: 'any' | 'all' | 'none') => void
  className?: string
}

export function TagFilter({
  entityType,
  selectedTags = [],
  onTagsChange,
  filterMode,
  onFilterModeChange,
  className,
}: TagFilterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { tags } = useTavernTagsStore()
  
  const categoryMap: Record<string, TagCategory> = {
    character: 'character',
    chat: 'chat',
    worldInfo: 'world-info',
    attachment: 'attachment',
  }
  
  const relevantTags = tags.filter(
    t => t.category === categoryMap[entityType] || t.category === 'custom'
  )
  
  const handleToggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter(id => id !== tagId))
    } else {
      onTagsChange([...selectedTags, tagId])
    }
  }
  
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <TagIcon className="h-3.5 w-3.5" />
            筛选
            {selectedTags.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1 text-xs">
                {selectedTags.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Select value={filterMode} onValueChange={onFilterModeChange as any}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">任意匹配</SelectItem>
                  <SelectItem value="all">全部匹配</SelectItem>
                  <SelectItem value="none">排除</SelectItem>
                </SelectContent>
              </Select>
              {selectedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onTagsChange([])}
                >
                  清空
                </Button>
              )}
            </div>
            <ScrollArea className="h-48">
              <div className="space-y-1">
                {relevantTags.map((tag) => (
                  <div
                    key={tag.id}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted',
                      selectedTags.includes(tag.id) && 'bg-muted'
                    )}
                    onClick={() => handleToggleTag(tag.id)}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 text-sm">{tag.name}</span>
                    {selectedTags.includes(tag.id) && (
                      <Check className="h-4 w-4" />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
      
      {/* 已选标签显示 */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tagId) => {
            const tag = tags.find(t => t.id === tagId)
            if (!tag) return null
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-[10px] h-5 px-1.5 gap-1"
                style={{
                  backgroundColor: `${tag.color}20`,
                  borderColor: tag.color,
                  color: tag.color,
                }}
              >
                {tag.name}
                <X
                  className="h-2.5 w-2.5 cursor-pointer"
                  onClick={() => handleToggleTag(tag.id)}
                />
              </Badge>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============ 标签管理对话框 ============
interface TagManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TagManagerDialog({ open, onOpenChange }: TagManagerDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<TagCategory | 'all'>('all')
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  
  const {
    tags,
    groups,
    deleteTag,
    addGroup,
    deleteGroup,
    exportTags,
    importTags,
  } = useTavernTagsStore()
  
  // 过滤标签
  const filteredTags = useMemo(() => {
    let result = tags
    
    if (searchQuery) {
      result = searchTags(result, searchQuery)
    }
    
    if (categoryFilter !== 'all') {
      result = result.filter(t => t.category === categoryFilter)
    }
    
    return sortTagsByUsage(result)
  }, [tags, searchQuery, categoryFilter])
  
  // 导出
  const handleExport = () => {
    const data = exportTags()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tags-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  // 导入
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const text = await file.text()
      const result = importTags(text)
      
      if (result.success) {
        alert(`成功导入 ${result.count} 个标签`)
      } else {
        alert(`导入失败: ${result.error}`)
      }
    }
    input.click()
  }
  
  const getCategoryIcon = (category: TagCategory) => {
    switch (category) {
      case 'character': return <Users className="h-4 w-4" />
      case 'chat': return <MessageSquare className="h-4 w-4" />
      case 'world-info': return <Globe className="h-4 w-4" />
      case 'attachment': return <Paperclip className="h-4 w-4" />
      case 'custom': return <Hash className="h-4 w-4" />
    }
  }
  
  const getCategoryName = (category: TagCategory) => {
    switch (category) {
      case 'character': return '角色'
      case 'chat': return '聊天'
      case 'world-info': return '世界信息'
      case 'attachment': return '附件'
      case 'custom': return '自定义'
    }
  }
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              标签管理
            </DialogTitle>
          </DialogHeader>
          
          {/* 工具栏 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="character">角色</SelectItem>
                <SelectItem value="chat">聊天</SelectItem>
                <SelectItem value="world-info">世界信息</SelectItem>
                <SelectItem value="attachment">附件</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              新建
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleImport}>
                  <Import className="h-4 w-4 mr-2" />
                  导入标签
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  导出标签
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {/* 标签列表 */}
          <ScrollArea className="h-[400px]">
            <div className="space-y-1">
              {filteredTags.map((tag) => {
                const stats = getTagUsageStats(tag)
                return (
                  <div
                    key={tag.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted"
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{tag.name}</span>
                        <Tooltip>
                          <TooltipTrigger>
                            {getCategoryIcon(tag.category)}
                          </TooltipTrigger>
                          <TooltipContent>
                            {getCategoryName(tag.category)}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {tag.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {tag.description}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {stats.total} 使用
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingTag(tag)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => {
                          if (confirm(`确定删除标签 "${tag.name}"？`)) {
                            deleteTag(tag.id)
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              
              {filteredTags.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <TagIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{searchQuery ? '无搜索结果' : '暂无标签'}</p>
                </div>
              )}
            </div>
          </ScrollArea>
          
          {/* 统计信息 */}
          <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
            <span>共 {tags.length} 个标签</span>
            <span>{groups.length} 个标签组</span>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* 创建标签对话框 */}
      {showCreateDialog && (
        <TagEditorDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />
      )}
      
      {/* 编辑标签对话框 */}
      {editingTag && (
        <TagEditorDialog
          open={!!editingTag}
          onOpenChange={() => setEditingTag(null)}
          tag={editingTag}
        />
      )}
    </>
  )
}

// ============ 标签编辑器对话框 ============
interface TagEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag?: Tag
}

function TagEditorDialog({ open, onOpenChange, tag }: TagEditorDialogProps) {
  const [name, setName] = useState(tag?.name || '')
  const [color, setColor] = useState<TagColor>(tag?.color || getRandomTagColor())
  const [category, setCategory] = useState<TagCategory>(tag?.category || 'custom')
  const [description, setDescription] = useState(tag?.description || '')
  
  const { addTag, updateTag } = useTavernTagsStore()
  
  const handleSave = () => {
    if (!name.trim()) return
    
    if (tag) {
      updateTag(tag.id, { name, color, category, description })
    } else {
      addTag({ name, color, category, description })
    }
    
    onOpenChange(false)
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tag ? '编辑标签' : '创建标签'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="标签名称"
            />
          </div>
          
          <div className="space-y-2">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-transform',
                    color === c ? 'scale-125 border-foreground' : 'border-transparent hover:scale-110'
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>类型</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as TagCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="character">角色</SelectItem>
                <SelectItem value="chat">聊天</SelectItem>
                <SelectItem value="world-info">世界信息</SelectItem>
                <SelectItem value="attachment">附件</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>描述（可选）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="标签描述"
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {tag ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 快速标签输入 ============
interface QuickTagInputProps {
  entityType: 'character' | 'chat' | 'worldInfo' | 'attachment'
  entityId: string | number
  placeholder?: string
  className?: string
}

export function QuickTagInput({
  entityType,
  entityId,
  placeholder = '输入标签名称后按回车...',
  className,
}: QuickTagInputProps) {
  const [value, setValue] = useState('')
  
  const { tags, addTag, associateTag, getTagsForEntity } = useTavernTagsStore()
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      
      // 查找现有标签
      const existingTag = tags.find(
        t => t.name.toLowerCase() === value.trim().toLowerCase()
      )
      
      if (existingTag) {
        associateTag(existingTag.id, entityType, entityId)
      } else {
        // 创建新标签
        const categoryMap: Record<string, TagCategory> = {
          character: 'character',
          chat: 'chat',
          worldInfo: 'world-info',
          attachment: 'attachment',
        }
        
        const id = addTag({
          name: value.trim(),
          color: getRandomTagColor(),
          category: categoryMap[entityType],
        })
        associateTag(id, entityType, entityId)
      }
      
      setValue('')
    }
  }
  
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <TagBadges
        entityType={entityType}
        entityId={entityId}
        maxDisplay={10}
        editable
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
    </div>
  )
}
