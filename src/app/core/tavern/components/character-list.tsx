'use client'

import { useState, useCallback } from 'react'
import { TavernCard } from '@/db/tavern'
import { selectAndImportCharacters } from '@/lib/tavern'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { convertFileSrc } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { Search, Plus, Upload, Menu, Filter } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { SettingsDrawer } from './settings-drawer'
import { TagFilter, TagBadges } from './tag-manager'
import { useTavernTagsStore, TagFilterConfig } from '@/stores/tavern-tags'

interface CharacterListProps {
  cards: TavernCard[]
  selectedCard: TavernCard | null
  onSelectCard: (card: TavernCard) => void
  onRefresh: () => Promise<void>
}

export function CharacterList({
  cards,
  selectedCard,
  onSelectCard,
  onRefresh,
}: CharacterListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [tagFilter, setTagFilter] = useState<TagFilterConfig>({
    includeTags: [],
    excludeTags: [],
    matchMode: 'any',
  })
  const { toast } = useToast()
  const { getTagsForEntity, filterEntities } = useTavernTagsStore()

  // 过滤角色卡 - 搜索 + 标签
  const filteredCards = cards.filter((card) => {
    // 搜索过滤
    const matchesSearch = 
      card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.description?.toLowerCase().includes(searchQuery.toLowerCase())
    
    if (!matchesSearch) return false
    
    // 标签过滤
    if (tagFilter.includeTags.length > 0 || tagFilter.excludeTags.length > 0) {
      const cardTags = getTagsForEntity('character', card.id)
      const cardTagIds = cardTags.map(t => t.id)
      
      // 排除标签
      if (tagFilter.excludeTags.some(t => cardTagIds.includes(t))) {
        return false
      }
      
      // 包含标签
      if (tagFilter.includeTags.length > 0) {
        if (tagFilter.matchMode === 'all') {
          return tagFilter.includeTags.every(t => cardTagIds.includes(t))
        } else {
          return tagFilter.includeTags.some(t => cardTagIds.includes(t))
        }
      }
    }
    
    return true
  })
  
  const hasActiveFilter = tagFilter.includeTags.length > 0 || tagFilter.excludeTags.length > 0

  // 导入角色卡
  const handleImport = async () => {
    setIsImporting(true)
    try {
      const results = await selectAndImportCharacters()
      if (results) {
        const successCount = results.filter((r) => r.success).length
        const failCount = results.length - successCount

        if (successCount > 0) {
          toast({
            title: '导入成功',
            description: `成功导入 ${successCount} 个角色卡${failCount > 0 ? `，${failCount} 个失败` : ''}`,
          })
          await onRefresh()
        } else if (failCount > 0) {
          toast({
            title: '导入失败',
            description: results[0].error || '未知错误',
            variant: 'destructive',
          })
        }
      }
    } catch (error) {
      toast({
        title: '导入失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }

  // 处理拖拽导入
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    // 注意：Tauri 的拖拽处理需要特殊处理，这里暂时只显示提示
    toast({
      title: '提示',
      description: '请使用导入按钮选择文件',
    })
  }, [toast])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <>
      {/* 设置侧边栏 */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      
      <div
        className="flex flex-col h-full"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* 头部 - 菜单、搜索和导入 */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            {/* 汉堡菜单按钮 */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              title="设置"
              className="flex-shrink-0"
            >
              <Menu className="h-5 w-5" />
            </Button>
            
            {/* 搜索框 */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索角色..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            
            {/* 标签筛选按钮 */}
            <Button
              size="icon"
              variant={hasActiveFilter ? 'default' : 'ghost'}
              onClick={() => setShowTagFilter(!showTagFilter)}
              title="标签筛选"
              className="flex-shrink-0"
            >
              <Filter className="h-4 w-4" />
            </Button>
            
            {/* 导入按钮 */}
            <Button
              size="icon"
              variant="ghost"
              onClick={handleImport}
              disabled={isImporting}
              title="导入角色卡"
              className="flex-shrink-0"
            >
              {isImporting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
            </Button>
          </div>
          
          {/* 标签筛选面板 */}
          {showTagFilter && (
            <div className="pt-2">
              <TagFilter
                entityType="character"
                selectedTags={tagFilter.includeTags}
                onTagsChange={(tags) => setTagFilter(prev => ({ ...prev, includeTags: tags }))}
                filterMode={tagFilter.matchMode === 'any' ? 'any' : 'all'}
                onFilterModeChange={(mode) => setTagFilter(prev => ({ ...prev, matchMode: mode === 'none' ? 'any' : mode }))}
              />
            </div>
          )}
        </div>

      {/* 角色列表 */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Upload className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm">暂无角色卡</p>
              <p className="text-xs mt-1">点击 + 按钮导入</p>
            </div>
          ) : (
            filteredCards.map((card) => (
              <CharacterListItem
                key={card.id}
                card={card}
                isSelected={selectedCard?.id === card.id}
                onClick={() => onSelectCard(card)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      </div>
    </>
  )
}

// 单个角色项
interface CharacterListItemProps {
  card: TavernCard
  isSelected: boolean
  onClick: () => void
}

function CharacterListItem({ card, isSelected, onClick }: CharacterListItemProps) {
  // 获取头像 URL
  const avatarUrl = card.avatarPath ? convertFileSrc(card.avatarPath) : undefined

  // 获取标签
  const tags: string[] = card.tags ? JSON.parse(card.tags) : []

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
        'hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
    >
      {/* 头像 */}
      <Avatar className="h-12 w-12 flex-shrink-0">
        <AvatarImage src={avatarUrl} alt={card.name} />
        <AvatarFallback className="text-lg">
          {card.name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{card.name}</span>
          {card.creator && (
            <span className="text-xs text-muted-foreground">by {card.creator}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate mt-0.5">
          {card.personality || card.description?.slice(0, 50) || '暂无描述'}
        </p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 overflow-hidden">
            {tags.slice(0, 3).map((tag, i) => (
              <span
                key={i}
                className="text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}
