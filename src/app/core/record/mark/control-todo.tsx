import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
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
import { TodoForm, TodoFormData } from "./todo-form"

export function ControlTodo() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<TodoFormData>({
    title: '',
    description: '',
    priority: 'medium'
  })
  const isMobile = useIsMobile() || checkIsMobileDevice()

  const { currentTagId, fetchTags, getCurrentTag, tags } = useTagStore()
  const { fetchMarks } = useMarkStore()
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  async function handleSuccess() {
    if (!formData.title.trim()) {
      return
    }

    const todoData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority
    }

    await insertMark({
      tagId: selectedTagId,
      type: 'todo',
      desc: formData.title.trim(),
      content: JSON.stringify(todoData),
      url: ''
    })

    await fetchMarks()
    await fetchTags()
    getCurrentTag()

    handleRecordComplete(router)

    setFormData({
      title: '',
      description: '',
      priority: 'medium'
    })
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

  const formContent = (
    <TodoForm
      mode="create"
      data={formData}
      onChange={setFormData}
      selectedTagId={selectedTagId}
      onTagChange={setSelectedTagId}
      tags={tags}
      showTagSelector={true}
    />
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
                disabled={!formData.title.trim()}
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
                disabled={!formData.title.trim()}
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
