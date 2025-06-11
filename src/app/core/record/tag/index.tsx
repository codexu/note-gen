"use client"

import * as React from "react"
import { useTranslations } from 'next-intl'
import { ArrowUpDown, TagIcon, Lightbulb } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { TagItem } from './tag-item'
import { initTagsDb, insertTag, Tag } from "@/db/tags"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import useChatStore from "@/stores/chat"

export function TagManage() {
  const t = useTranslations();
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState<string>("")
  const { init } = useChatStore()

  const {
    currentTag,
    tags,
    fetchTags,
    initTags,
    setCurrentTagId,
    getCurrentTag
  } = useTagStore()

  const { fetchMarks } = useMarkStore()

  async function quickAddTag() {
    const res = await insertTag({ name })
    await setCurrentTagId(res.lastInsertId as number)
    await fetchTags()
    getCurrentTag()
    setOpen(false)
    fetchMarks()
  }

  async function handleSelect(tag: Tag) {
    await setCurrentTagId(tag.id)
    getCurrentTag()
    setOpen(false)
    await fetchMarks()
    await init(tag.id)
  }

  React.useEffect(() => {
    const fetchData = async() => {
      await initTagsDb()
      await fetchTags()
      await initTags()
    }
    fetchData()
  }, [initTags, fetchTags])

  return (
    <>
      <div className="flex gap-1 w-full items-center justify-between px-0 lg:px-2 mt-2 lg:mt-0">
        <div
          className="w-full h-9 border cursor-pointer rounded flex justify-between items-center px-3 bg-white hover:bg-gray-50
            dark:bg-black dark:hover:bg-zinc-800"
          onClick={() => setOpen(true)}
        >
          <div className="flex gap-2 items-center">
            { name === 'Idea' ? <Lightbulb className="size-4" /> : <TagIcon className="size-4" /> }
            <span className="text-xs">{currentTag?.name} ({currentTag?.total})</span>
          </div>
          <ArrowUpDown className="size-3" />
        </div>
      </div>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('record.mark.tag.searchPlaceholder')} onValueChange={(name) => setName(name)} />
        <CommandList>
          <CommandEmpty>
            <p className="text-gray-600">{t('record.mark.tag.noResults')}</p>
            <Button className="mt-4" onClick={quickAddTag}>{t('record.mark.tag.quickAdd')}</Button>
          </CommandEmpty>
          <CommandGroup heading={t('record.mark.tag.pinned')}>
            {
              tags?.filter((tag) => tag.isPin).map((tag) => 
                <TagItem key={tag.id} tag={tag} onChange={fetchTags} onSelect={handleSelect.bind(null, tag)} />)
            }
          </CommandGroup>
          <CommandGroup heading={t('record.mark.tag.others')}>
            {
              tags?.filter((tag) => !tag.isPin).map((tag) => 
                <TagItem key={tag.id} tag={tag} onChange={fetchTags} onSelect={handleSelect.bind(null, tag)} />)
            }
          </CommandGroup>
          <CommandSeparator />
        </CommandList>
      </CommandDialog>
    </>
  )
}
