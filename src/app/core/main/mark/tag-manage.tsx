"use client"
import * as React from "react"
import { useTranslations } from 'next-intl'
import { Plus, TagIcon, Inbox, SquareCheck } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { initTagsDb, insertTag, Tag, delTag, updateTag, updateTagsOrder } from "@/db/tags"
import type { Mark } from "@/db/marks"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import useChatStore from "@/stores/chat"
import { MarkLoading } from './mark-loading'
import { ImageGallery } from './image-gallery'
import { filterMarks } from './mark-filters'
import { MarkListDefaultView } from './mark-list-default-view'
import { MarkListCompactView } from './mark-list-compact-view'
import { MarkListCardView } from './mark-list-card-view'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/enhanced-context-menu"
import { TagMobileActions } from './tag-mobile-actions'
import { useTextSize } from "@/contexts/text-size-context"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Wrapper for AccordionItem that accepts sortable props
function AccordionItemWrapper({ 
  value, 
  children,
  sortableAttributes,
  sortableListeners,
  sortableActivatorRef,
  ...props 
}: any) {
  return (
    <AccordionItem value={value} {...props}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.type === ContextMenu) {
          return React.cloneElement(child as React.ReactElement, {
            children: React.Children.map((child as React.ReactElement).props.children, (contextChild: any) => {
              if (React.isValidElement(contextChild) && contextChild.type === ContextMenuTrigger) {
                return React.cloneElement(contextChild as React.ReactElement, {
                  children: React.Children.map((contextChild as React.ReactElement).props.children, (triggerChild: any) => {
                    // 将 sortable 属性应用到 AccordionTrigger
                    if (React.isValidElement(triggerChild) && triggerChild.type === AccordionTrigger) {
                      return (
                        <div ref={sortableActivatorRef} {...sortableAttributes} {...sortableListeners}>
                          {triggerChild}
                        </div>
                      )
                    }
                    return triggerChild
                  })
                })
              }
              return contextChild
            })
          })
        }
        return child
      })}
    </AccordionItem>
  )
}

// Sortable Tag Item Component
function SortableTagItem({ tag, children }: { tag: Tag; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    setActivatorNodeRef,
  } = useSortable({ id: tag.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // 将拖拽激活器引用传递给子组件
  return (
    <div ref={setNodeRef} style={style}>
      {React.cloneElement(children as React.ReactElement, { 
        sortableAttributes: attributes,
        sortableListeners: listeners,
        sortableActivatorRef: setActivatorNodeRef
      })}
    </div>
  )
}

export function TagManage() {
  const t = useTranslations();
  const { getContextMenuTextSize } = useTextSize()
  const [newTagName, setNewTagName] = React.useState<string>("")
  const [isAdding, setIsAdding] = React.useState(false)
  const [editingTagId, setEditingTagId] = React.useState<number | null>(null)
  const [editingName, setEditingName] = React.useState<string>("")
  const [expandedTagId, setExpandedTagId] = React.useState("")
  const [hasInitialized, setHasInitialized] = React.useState(false)
  const { init } = useChatStore()
  const textSize = getContextMenuTextSize('record')

  // 自定义传感器，忽略记录项的拖拽
  const customPointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      delay: 250,
      tolerance: 5,
    },
  })

  const sensors = useSensors(
    customPointerSensor,
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // 处理拖拽开始，检查是否是记录项
  const handleDragStart = (event: any) => {
    const target = event.active?.node?.current as HTMLElement
    
    // 如果拖拽的是记录项，取消 dnd-kit 拖拽
    if (target?.querySelector('[data-mark-item]') || target?.closest('[data-mark-item]')) {
      event.cancel()
    }
  }

  const {
    currentTag,
    currentTagId,
    tags,
    fetchTags,
    initTags,
    setCurrentTagId,
    getCurrentTag
  } = useTagStore()

  const {
    marks,
    queues,
    fetchMarks,
    recordFilters,
    recordViewMode,
    hasActiveRecordFilters,
    setVisibleMarkIds,
    pendingScrollMarkId,
    setPendingScrollMarkId,
    highlightedMarkId,
    setHighlightedMarkId,
  } = useMarkStore()

  async function handleAddTag() {
    if (!newTagName.trim()) return
    const res = await insertTag({ name: newTagName.trim() })
    const newTagId = res.lastInsertId as number
    await setCurrentTagId(newTagId)
    await fetchTags()
    getCurrentTag()
    await fetchMarks()
    await init(newTagId)
    setNewTagName("")
    setIsAdding(false)
    // 添加新标签后自动展开
    setExpandedTagId(newTagId.toString())
  }

  async function handleSelectTag(tag: Tag) {
    await setCurrentTagId(tag.id)
    getCurrentTag()
    await fetchMarks()
    await init(tag.id)
  }

  async function handleDeleteTag(tagId: number) {
    await delTag(tagId)
    await fetchTags()
    getCurrentTag()
  }

  async function handleRename(tag: Tag) {
    if (!editingName.trim()) return
    await updateTag({ ...tag, name: editingName.trim() })
    await fetchTags()
    getCurrentTag()
    setEditingTagId(null)
    setEditingName("")
  }

  function startEditing(tag: Tag) {
    setEditingTagId(tag.id)
    setEditingName(tag.name)
  }

  // 获取当前标签下的记录
  const getTagMarks = (tagId: number) => {
    return marks.filter(mark => mark.tagId === tagId)
  }

  const filtersActive = hasActiveRecordFilters()

  const getFilteredTagMarks = React.useCallback((tagId: number) => {
    return filterMarks(getTagMarks(tagId), {
      ...recordFilters,
      tagId: 'all',
    })
  }, [marks, recordFilters])

  const visibleTags = React.useMemo(() => {
    return tags.filter((tag) => {
      if (recordFilters.tagId !== 'all' && tag.id !== recordFilters.tagId) {
        return false
      }

      if (!filtersActive) {
        return true
      }

      const hasQueue = queues.some((queue) => queue.tagId === tag.id)
      return getFilteredTagMarks(tag.id).length > 0 || hasQueue
    })
  }, [filtersActive, getFilteredTagMarks, queues, recordFilters.tagId, tags])

  const visibleMarkIds = React.useMemo(() => {
    return visibleTags.flatMap((tag) => getFilteredTagMarks(tag.id).map((mark: Mark) => mark.id))
  }, [getFilteredTagMarks, visibleTags])

  // 处理拖拽结束
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tags.findIndex((tag) => tag.id === active.id)
      const newIndex = tags.findIndex((tag) => tag.id === over.id)

      const newTags = arrayMove(tags, oldIndex, newIndex)
      
      // 更新本地状态
      const updatedTags = newTags.map((tag, index) => ({
        ...tag,
        sortOrder: index
      }))
      
      // 批量更新数据库
      await updateTagsOrder(updatedTags.map(tag => ({ id: tag.id, sortOrder: tag.sortOrder || 0 })))
      await fetchTags()
    }
  }

  React.useEffect(() => {
    const fetchData = async() => {
      await initTagsDb()
      await fetchTags()
      await initTags()
      await fetchMarks()
    }
    fetchData()
  }, [initTags, fetchTags, fetchMarks])

  // 初始化时展开当前标签（只执行一次）
  React.useEffect(() => {
    if (currentTag && !hasInitialized) {
      setExpandedTagId(currentTag.id.toString())
      setHasInitialized(true)
    }
  }, [currentTag, hasInitialized])

  // 监听刷新事件，展开当前标签
  React.useEffect(() => {
    const handleRefresh = () => {
      if (currentTagId) {
        setExpandedTagId(currentTagId.toString())
        fetchMarks()
      }
    }
    
    emitter.on(EmitterRecordEvents.refreshMarks, handleRefresh)
    
    return () => {
      emitter.off(EmitterRecordEvents.refreshMarks, handleRefresh)
    }
  }, [currentTagId, fetchMarks])

  React.useEffect(() => {
    if (!pendingScrollMarkId || expandedTagId !== currentTagId.toString()) {
      return
    }

    if (!marks.some((mark) => mark.id === pendingScrollMarkId && mark.tagId === currentTagId)) {
      return
    }

    let cancelled = false
    let attempts = 0
    const maxAttempts = 20

    const scrollToTarget = () => {
      if (cancelled) return

      const target = document.querySelector<HTMLElement>(`[data-mark-id="${pendingScrollMarkId}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedMarkId(pendingScrollMarkId)
        setPendingScrollMarkId(null)
        return
      }

      if (attempts >= maxAttempts) {
        setPendingScrollMarkId(null)
        return
      }

      attempts += 1
      window.setTimeout(scrollToTarget, 50)
    }

    scrollToTarget()

    return () => {
      cancelled = true
    }
  }, [currentTagId, expandedTagId, marks, pendingScrollMarkId, setHighlightedMarkId, setPendingScrollMarkId])

  React.useEffect(() => {
    if (!highlightedMarkId) {
      return
    }

    const clearHighlightTimer = window.setTimeout(() => {
      setHighlightedMarkId(null)
    }, 3000)

    return () => {
      clearTimeout(clearHighlightTimer)
    }
  }, [highlightedMarkId, setHighlightedMarkId])

  React.useEffect(() => {
    setVisibleMarkIds(visibleMarkIds)
    return () => setVisibleMarkIds([])
  }, [setVisibleMarkIds, visibleMarkIds])

  const renderTagRecords = React.useCallback((tagId: number) => {
    const filteredMarks = getFilteredTagMarks(tagId).filter((mark: Mark) => {
      if (mark.type === 'image' || mark.type === 'scan') {
        return mark.content && mark.content.trim() !== ''
      }
      return true
    })

    if (filteredMarks.length === 0 && queues.filter(queue => queue.tagId === tagId).length === 0) {
      return (
        <Empty className="border-0 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle className="text-sm">{t('record.mark.empty')}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {t('record.mark.mark.emptyHint')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    switch (recordViewMode) {
    case 'compact':
      return <MarkListCompactView marks={filteredMarks} />
    case 'cards':
      return <MarkListCardView marks={filteredMarks} />
    case 'list':
    default:
      return <MarkListDefaultView marks={filteredMarks} />
    }
  }, [getFilteredTagMarks, queues, recordViewMode, t])

  return (
    <div className="w-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleTags.map(tag => tag.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* 标签列表 */}
          <Accordion 
            type="single" 
            collapsible 
            value={expandedTagId} 
            onValueChange={(value) => {
              // 直接设置展开状态，允许折叠（折叠时 value 为空字符串）
              setExpandedTagId(value || "")
            }}
            className="w-full"
          >
            {visibleTags.length === 0 ? (
              <Empty className="border-0 py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm">{t('record.mark.list.emptyFiltered')}</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    {t('record.mark.list.emptyFilteredHint')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : visibleTags.map((tag) => (
              <SortableTagItem key={tag.id} tag={tag}>
                <AccordionItemWrapper value={tag.id.toString()}>
                  <ContextMenu>
                    <ContextMenuTrigger>
                      <AccordionTrigger 
                        className={`px-3 py-2 hover:no-underline opacity-50 ${currentTagId === tag.id && 'bg-accent opacity-100'}`}
                        onClick={() => {
                          if (tag.id !== currentTagId) {
                            handleSelectTag(tag)
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 flex-1">
                          {
                            currentTagId === tag.id ? 
                            <SquareCheck className="size-3" />:
                            <TagIcon className="size-3" />
                          }
                          {editingTagId === tag.id ? (
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(tag)
                                if (e.key === 'Escape') setEditingTagId(null)
                                e.stopPropagation()
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-6 text-sm"
                              autoFocus
                            />
                          ) : (
                            <div className="text-xs w-full flex items-center justify-between gap-2">
                              <span className={`flex-1 ${currentTagId === tag.id && 'font-bold'}`}>{tag.name}</span>
                              <span className="text-muted-foreground">{tag.total && tag.total > 0 ? tag.total : ''}</span>
                              <TagMobileActions 
                                tag={tag}
                                onRename={startEditing}
                                onDelete={handleDeleteTag}
                                isEditing={editingTagId === tag.id}
                              />
                            </div>
                          )}
                        </div>
                      </AccordionTrigger>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem disabled={editingTagId === tag.id} onClick={() => startEditing(tag)}>
                        {t('record.mark.tag.rename')}
                      </ContextMenuItem>
                      <ContextMenuItem disabled={tag.isLocked} onClick={() => handleDeleteTag(tag.id)}>
                        <span className="text-red-600">{t('record.mark.tag.delete')}</span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  <AccordionContent className="px-0 pb-0">

                    {/* 显示当前标签的队列（正在处理中的记录） */}
                    {queues.filter(queue => queue.tagId === tag.id).map((queue) => (
                      <MarkLoading key={queue.queueId} mark={queue} />
                    ))}

                    {/* 图片画廊 - 显示当前标签下所有无内容的图片 */}
                    <ImageGallery marks={getFilteredTagMarks(tag.id)} />
                    
                    {/* 显示已完成的记录 - 过滤掉没有内容的图片记录 */}
                    {renderTagRecords(tag.id)}
                  </AccordionContent>
                </AccordionItemWrapper>
              </SortableTagItem>
            ))}
          </Accordion>
        </SortableContext>
      </DndContext>

      {/* 添加标签 */}
      <div className="p-2">
        {isAdding ? (
          <div className="flex gap-2">
            <Input
              placeholder={t('record.mark.tag.newTagPlaceholder')}
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTag()
                if (e.key === 'Escape') {
                  setIsAdding(false)
                  setNewTagName("")
                }
              }}
              className={`h-8 text-${textSize}`}
              autoFocus
            />
            <Button size="sm" onClick={handleAddTag} className={`h-8 text-${textSize}`}>
              {t('record.mark.tag.add')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
            className={`w-full h-8 text-${textSize}`}
          >
            <Plus className="size-3 mr-1" />
            {t('record.mark.tag.newTag')}
          </Button>
        )}
      </div>
    </div>
  )
}
