import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Lock, Pin, TagIcon } from "lucide-react"
import { delTag, Tag, updateTag } from "@/db/tags"
import React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

function ItemIcon({ isLocked=false, isPin=false }) {
  if (isLocked) {
    return <Lock className="scale-75 text-gray-500" />
  } else {
    if (isPin) {
      return <Pin className="scale-75 text-gray-500" />
    } else {
      return <TagIcon className="scale-75 text-gray-500" />
    }
  }
}

function ItemContent({ value, isEditing, onChange }: { value: string, isEditing: boolean, onChange: (name: string) => void }) {
  const t = useTranslations();
  const [name, setName] = React.useState(value)
  if (isEditing) {
    return (
      <div className="flex w-full max-w-sm items-center space-x-2">
        <Input
          className="w-[320px]"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value) }}
        />
        <Button type="submit" onClick={async() => { 
          onChange(name)
        }}>{t('record.mark.tag.rename')}</Button>
      </div>
    )
  } else {
    return <span>{value}</span>
  }
}


export function TagItem(
  { tag, onChange, onSelect }:
  { tag: Tag, onChange: () => void, onSelect: () => void }) 
{
  const t = useTranslations();
  const [isEditing, setIsEditing] = React.useState(false)

  const { fetchTags, getCurrentTag, currentTagId } = useTagStore()

  async function handleDel() {
    await delTag(tag.id)
    onChange()
  }

  async function togglePin() {
    await updateTag({ ...tag, isPin: !tag.isPin })
    onChange()
  }

  async function updateName(name: string) {
    setIsEditing(false)
    await updateTag({ ...tag, name })
    await fetchTags()
    getCurrentTag()
    onChange()
  }

  function handleSelect() {
    if (!isEditing) {
      onSelect()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger onClick={handleSelect}>
        <div className={`
          ${tag.id === currentTagId ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}
          flex justify-between items-center w-full cursor-pointer rounded px-2 py-1.5 text-sm transition-colors
        `}>
          <div className="flex gap-2 items-center min-w-0 flex-1">
            <ItemIcon isLocked={tag.isLocked} isPin={tag.isPin} />
            <ItemContent value={tag.name} isEditing={isEditing} onChange={updateName} />
          </div>
          <span className={`text-xs ml-2 flex-shrink-0 ${
            tag.id === currentTagId ? 'text-primary-foreground/70' : 'text-muted-foreground'
          }`}>
            {tag.total && tag.total > 0 ? tag.total : ''}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem inset disabled={tag.isLocked} onClick={togglePin}>
          { tag.isPin ? t('record.mark.tag.unpin') : t('record.mark.tag.pin') }
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isEditing} onClick={setIsEditing.bind(null, true)}>
          {t('record.mark.tag.rename')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={tag.isLocked} onClick={handleDel}>
          {t('record.mark.tag.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
