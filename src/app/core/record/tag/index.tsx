"use client"

import * as React from "react"
import { useTranslations } from 'next-intl'
import { Plus, TagIcon, Lightbulb, Lock } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { initTagsDb, insertTag, Tag, delTag, updateTag } from "@/db/tags"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import useChatStore from "@/stores/chat"
import { MarkItem } from '../mark/mark-item'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function TagManage() {
  const t = useTranslations();
  const [newTagName, setNewTagName] = React.useState<string>("")
  const [isAdding, setIsAdding] = React.useState(false)
  const [editingTagId, setEditingTagId] = React.useState<number | null>(null)
  const [editingName, setEditingName] = React.useState<string>("")
  const [expandedTagId, setExpandedTagId] = React.useState<string | undefined>(undefined)
  const [hasInitialized, setHasInitialized] = React.useState(false)
  const { init } = useChatStore()

  const {
    currentTag,
    currentTagId,
    tags,
    fetchTags,
    initTags,
    setCurrentTagId,
    getCurrentTag
  } = useTagStore()

  const { marks, fetchMarks } = useMarkStore()

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

  React.useEffect(() => {
    const fetchData = async() => {
      await initTagsDb()
      await fetchTags()
      await initTags()
    }
    fetchData()
  }, [initTags, fetchTags])

  // 初始化时展开当前标签（只执行一次）
  React.useEffect(() => {
    if (currentTag && !hasInitialized) {
      setExpandedTagId(currentTag.id.toString())
      setHasInitialized(true)
    }
  }, [currentTag, hasInitialized])

  return (
    <div className="w-full">

      {/* 标签列表 */}
      <Accordion 
        type="single" 
        collapsible 
        value={expandedTagId} 
        onValueChange={(value) => {
          // 直接设置展开状态，允许折叠（value 为 undefined）
          setExpandedTagId(value)
        }}
        className="w-full"
      >
        {tags?.map((tag) => (
          <AccordionItem key={tag.id} value={tag.id.toString()}>
            <ContextMenu>
              <ContextMenuTrigger>
                <AccordionTrigger 
                  className="px-3 py-2 hover:no-underline hover:bg-accent"
                  onClick={() => {
                    if (tag.id !== currentTagId) {
                      handleSelectTag(tag)
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-1">
                    {tag.isLocked ? (
                      <Lock className="size-4 text-muted-foreground" />
                    ) : tag.name === 'Idea' ? (
                      <Lightbulb className="size-4" />
                    ) : (
                      <TagIcon className="size-4" />
                    )}
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
                      <span className="text-sm font-medium">{tag.name}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {tag.total || 0}
                    </span>
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
              {getTagMarks(tag.id).map((mark) => (
                <MarkItem key={mark.id} mark={mark} />
              ))}
              {getTagMarks(tag.id).length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('record.mark.empty')}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

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
              className="h-8 text-xs"
              autoFocus
            />
            <Button size="sm" onClick={handleAddTag} className="h-8 text-xs">
              {t('record.mark.tag.add')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
            className="w-full h-8 text-xs"
          >
            <Plus className="size-3 mr-1" />
            {t('record.mark.tag.newTag')}
          </Button>
        )}
      </div>
    </div>
  )
}
