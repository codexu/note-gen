'use client'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog"
import { ResponsiveSelect } from "@/components/responsive-select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { extractTitle } from "@/lib/markdown"
import { getFilePathOptions, getWorkspacePath, getGenericPathOptions } from "@/lib/workspace"
import useTagStore from "@/stores/tag"
import { BaseDirectory, readDir, writeTextFile } from "@tauri-apps/plugin-fs"
import { Store } from "@tauri-apps/plugin-store"
import { SquarePen, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from 'next/navigation'
import { Chat } from "@/db/chats"
import { useTranslations } from "next-intl"
import useArticleStore from "@/stores/article"
import { useIsMobile } from "@/hooks/use-mobile"

type CheckedState = boolean | "indeterminate"

export function NoteOutput({chat}: {chat: Chat}) {
  const { deleteTag, currentTagId } = useTagStore()
  const { loadFileTree } = useArticleStore()
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('/')
  const [folders, setFolders] = useState<string[]>([])
  const [isRemove, setIsRemove] = useState<CheckedState>(true)
  const t = useTranslations('record.chat')
  const router = useRouter()
  const isMobile = useIsMobile()

  async function handleTransform() {
    const content = chat?.content || ''
    // 统一处理：将空格替换为下划线，确保本地和远程文件名一致
    const sanitizedTitle = title.replace(/\s+/g, '_')
    const writePath = `${path}/${sanitizedTitle}`
    
    // Use workspace functions instead of directly using BaseDirectory.AppData
    const pathOptions = await getFilePathOptions(writePath)
    if (pathOptions.baseDir) {
      await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
    } else {
      // Handle custom workspace (direct path, no baseDir)
      await writeTextFile(pathOptions.path, content)
    }
    
    const store = await Store.load('store.json');
    await store.set('activeFilePath', title)
    if (isRemove) {
      deleteTag(currentTagId)
    }
    setOpen(false)
    await loadFileTree()
    router.push(isMobile ? '/mobile/writing' : '/core/article')
  }

  async function readArticleDir() {
    const workspace = await getWorkspacePath()
    let folders = []
    
    if (workspace.isCustom) {
      const pathOptions = await getGenericPathOptions('', '')
      const dirs = (await readDir(pathOptions.path)).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    } else {
      const dirs = (await readDir('article', { baseDir: BaseDirectory.AppData })).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    }
    
    setFolders(folders)
  }

  useEffect(() => {
    setIsRemove(chat?.tagId !== 1)
    setTitle(extractTitle(chat?.content || '') + '.md')
    readArticleDir()
  }, [chat])

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('note.convert')}
        >
          <SquarePen className="size-4" />
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-[525px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('note.convert')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('note.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="mt-2 flex flex-col gap-2 px-4 sm:px-0">
          <Label>{t('note.filename')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ResponsiveSelect
              title={t('note.selectFolder')}
              value={path}
              onValueChange={setPath}
              className="sm:w-[180px]"
              placeholder={t('note.selectFolder')}
              options={[
                { value: '/', label: t('note.rootDirectory') },
                ...folders.map(folder => ({ value: folder, label: folder })),
              ]}
            />
            <Input className="border-none" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox disabled={chat?.tagId === 1} id="terms" checked={isRemove} onCheckedChange={value => setIsRemove(value)} />
            <label
              htmlFor="terms"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t('note.deleteTag')}
            </label>
          </div>
        </div>
        <ResponsiveDialogFooter>
          <div className="flex flex-col items-stretch gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-xs text-zinc-400 flex items-center gap-1"><TriangleAlert className="size-4" />{t('note.warning')}</p>
            <Button type="submit" onClick={handleTransform}>{t('note.convert_button')}</Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
