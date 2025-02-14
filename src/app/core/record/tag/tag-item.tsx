import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Lock, Pin, TagIcon } from "lucide-react"
import { delTag, Tag, updateTag } from "@/db/tags"
import { CommandItem, CommandShortcut } from "@/components/ui/command"
import React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import useTagStore from "@/stores/tag"
import { _t } from '@/locales/index';

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
        }}>重命名</Button>
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
        <CommandItem className={`${tag.id === currentTagId && '!bg-primary'} data-[selected=true]:bg-transparent flex justify-between items-center w-full cursor-pointer`}>
          <div className={`${tag.id === currentTagId && 'text-primary-foreground'} flex gap-2 items-center`}>
            <ItemIcon isLocked={tag.isLocked} isPin={tag.isPin} />
            <ItemContent value={tag.name} isEditing={isEditing} onChange={updateName} />
          </div>
          <CommandShortcut>{ tag.total || 0 }</CommandShortcut>
        </CommandItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem inset disabled={tag.isLocked} onClick={togglePin}>
          { tag.isPin ? _t('unpin_tag') : _t('pin_tag') }
        </ContextMenuItem>
        <ContextMenuItem inset disabled={isEditing} onClick={setIsEditing.bind(null, true)}>
          {_t('rename_tag')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled={tag.isLocked} onClick={handleDel}>
          {_t('delete_tag')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
