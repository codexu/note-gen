import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CheckSquare } from "lucide-react"
import { useState, useCallback, useEffect } from "react"
import emitter from "@/lib/emitter"
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Priority = 'low' | 'medium' | 'high'

interface TodoData {
  title: string
  description: string
  priority: Priority
}

export function ControlTodo() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag, tags } = useTagStore()
  const { fetchMarks } = useMarkStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  async function handleSuccess() {
    if (!title.trim()) {
      return
    }

    const todoData: TodoData = {
      title: title.trim(),
      description: description.trim(),
      priority
    }

    await insertMark({
      tagId: selectedTagId,
      type: 'todo',
      desc: title.trim(),
      content: JSON.stringify(todoData),
      url: ''
    })

    await fetchMarks()
    await fetchTags()
    getCurrentTag()

    handleRecordComplete(router)

    setTitle('')
    setDescription('')
    setPriority('medium')
    setOpen(false)
  }

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-todo', handleOpen)
    return () => {
      emitter.off('toolbar-shortcut-todo', handleOpen)
    }
  }, [handleOpen])

  // Sync selectedTagId with currentTagId when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTagId(currentTagId)
    }
  }, [open, currentTagId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSuccess()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const formContent = (
    <div className="space-y-4">
      <div>
        <Label htmlFor="todo-tag">{t('record.mark.todo.selectTag')}</Label>
        <Select value={String(selectedTagId)} onValueChange={(value) => setSelectedTagId(Number(value))}>
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder={t('record.mark.todo.selectTag')} />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={String(tag.id)}>
                <div className="flex items-center gap-2">
                  <span className="truncate">{tag.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="todo-title">{t('record.mark.todo.title')} *</Label>
        <Input
          id="todo-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('record.mark.todo.titlePlaceholder')}
          onKeyDown={handleKeyDown}
          autoFocus
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor="todo-description">{t('record.mark.todo.description')}</Label>
        <Textarea
          id="todo-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('record.mark.todo.descriptionPlaceholder')}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor="todo-priority">{t('record.mark.todo.priority')}</Label>
        <Tabs value={priority} onValueChange={(value) => setPriority(value as Priority)} className="mt-1.5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="low" className="data-[state=active]:bg-green-800 data-[state=active]:text-white">
              {t('record.mark.todo.priorityLow')}
            </TabsTrigger>
            <TabsTrigger value="medium" className="data-[state=active]:bg-orange-700 data-[state=active]:text-white">
              {t('record.mark.todo.priorityMedium')}
            </TabsTrigger>
            <TabsTrigger value="high" className="data-[state=active]:bg-red-900 data-[state=active]:text-white">
              {t('record.mark.todo.priorityHigh')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  )

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<CheckSquare />} tooltipText={t('record.mark.type.todo')} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('record.mark.todo.title')}</DrawerTitle>
              <DrawerDescription>
                {t('record.mark.todo.description')}
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              {formContent}
            </div>
            <DrawerFooter>
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!title.trim()}
                className="w-full"
              >
                {t('record.mark.todo.save')}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <TooltipButton icon={<CheckSquare />} tooltipText={t('record.mark.type.todo')} />
          </DialogTrigger>
          <DialogContent className="min-w-full md:min-w-[650px]">
            <DialogHeader>
              <DialogTitle>{t('record.mark.todo.title')}</DialogTitle>
              <DialogDescription>
                {t('record.mark.todo.description')}
              </DialogDescription>
            </DialogHeader>
            {formContent}
            <DialogFooter>
              <Button
                type="submit"
                onClick={handleSuccess}
                disabled={!title.trim()}
              >
                {t('record.mark.todo.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
