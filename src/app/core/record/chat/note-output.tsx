'use client'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { extractTitle } from "@/lib/markdown"
import useTagStore from "@/stores/tag"
import { CheckedState } from "@radix-ui/react-checkbox"
import { BaseDirectory, readDir, writeTextFile } from "@tauri-apps/plugin-fs"
import { Store } from "@tauri-apps/plugin-store"
import { SquarePen, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { redirect } from 'next/navigation'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chat } from "@/db/chats"
import { _t } from '@/locales/index';

export function NoteOutput({chat}: {chat: Chat}) {
  const { deleteTag, currentTagId } = useTagStore()
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('/')
  const [folders, setFolders] = useState<string[]>([])
  const [isRemove, setIsRemove] = useState<CheckedState>(true)

  async function handleTransform() {
    const content = decodeURIComponent(chat?.content || '')
    const writeTo = `article${path}/${title.replace(/ /g, '_')}`
    await writeTextFile(writeTo, content, { baseDir: BaseDirectory.AppData })
    const store = await Store.load('store.json');
    await store.set('activeFilePath', title)
    if (isRemove) {
      deleteTag(currentTagId)
    }
    setOpen(false)
    redirect('/core/article')
  }

  async function readArticleDir() {
    const dirs = (await readDir('article', { baseDir: BaseDirectory.AppData })).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
    setFolders(dirs)
  }

  useEffect(() => {
    setIsRemove(chat?.tagId !== 1)
    setTitle(extractTitle(chat?.content || '') + '.md')
    readArticleDir()
  }, [chat])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <a className="cursor-pointer flex items-center gap-1 hover:underline">
          <SquarePen className="size-4" />
          {_t('writing')}
        </a>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{_t('transform_article')}</DialogTitle>
          <DialogDescription>
            {_t('current_note_generated_by_ai')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <Label>{_t('file_name')}</Label>
          <div className="flex border rounded-lg">
            <Select value={path} onValueChange={setPath}>
              <SelectTrigger className="w-[180px] border-none outline-none">
                <SelectValue placeholder={_t('choose_folder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="/">{_t('root_directory')}</SelectItem>
                  {
                    folders.map((folder, index) => {
                      return <SelectItem key={index} value={folder}>{folder}</SelectItem>
                    })
                  }
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input className="border-none" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox disabled={chat?.tagId === 1} id="terms" checked={isRemove} onCheckedChange={value => setIsRemove(value)} />
            <label
              htmlFor="terms"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {_t('delete_current_tag_record_note')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <div className="flex items-center justify-end gap-2 pt-4">
            <p className="text-xs text-zinc-400 flex items-center gap-1"><TriangleAlert className="size-4" />{_t('transform_after_redirect')}</p>
            <Button type="submit" onClick={handleTransform}>{_t('transform')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
