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
import useTagStore from "@/stores/tag"
import { CheckSquare } from "lucide-react"
import { useState, useCallback, useEffect, useRef } from "react"
import emitter from "@/lib/emitter"
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { TodoForm, TodoFormData } from "./todo-form"
import { useRecordCompletion } from './use-record-completion'
import useSettingStore from '@/stores/setting'
import { getRecordSaveTagIdFromTags } from '@/lib/record-save-target'

export function ControlTodo() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<TodoFormData>({
    title: '',
    description: '',
    priority: 'medium'
  })
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const completeRecord = useRecordCompletion()

  const { currentTagId, tags, fetchTags, initTags } = useTagStore()
  const [creatingTag, setCreatingTag] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState<number>(currentTagId)

  async function handleSuccess() {
    if (creatingTag || !formData.title.trim()) {
      return
    }

    const todoData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority
    }

    const result = await insertMark({
      tagId: selectedTagId,
      type: 'todo',
      desc: formData.title.trim(),
      content: JSON.stringify(todoData),
      url: ''
    })
    const markId = Number(result.lastInsertId || 0) || null

    await completeRecord({
      markId,
      tagId: selectedTagId,
      typeLabel: t('record.mark.type.todo'),
    })

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
    if (!open) {
      setCreatingTag(false)
      return
    }

    let cancelled = false
    const prepareTags = async () => {
      await initTags()
      await fetchTags()
      if (!cancelled) {
        const tagState = useTagStore.getState()
        const settingState = useSettingStore.getState()
        setSelectedTagId(getRecordSaveTagIdFromTags({
          mode: settingState.recordSaveTargetMode,
          currentTagId: tagState.currentTagId,
          lastTagId: settingState.lastRecordTagId,
          fixedTagId: settingState.fixedRecordTagId,
          tagIds: tagState.tags.map((tag) => tag.id),
        }))
      }
    }

    void prepareTags()
    return () => {
      cancelled = true
    }
  }, [fetchTags, initTags, open])

  const handleDrawerAnimationEnd = useCallback((drawerOpen: boolean) => {
    if (!drawerOpen) return

    titleInputRef.current?.focus()
  }, [])

  const formContent = (
    <TodoForm
      mode="create"
      data={formData}
      onChange={setFormData}
      autoFocus={!isMobile}
      titleInputRef={titleInputRef}
      selectedTagId={selectedTagId}
      onTagChange={setSelectedTagId}
      onCreatingTagChange={setCreatingTag}
      tags={tags}
      showTagSelector={true}
      onSubmit={handleSuccess}
      onCancel={() => setOpen(false)}
    />
  )

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={handleOpenChange} onAnimationEnd={handleDrawerAnimationEnd}>
          <DrawerTrigger asChild>
            <TooltipButton icon={<CheckSquare />} tooltipText={t('record.mark.type.todo')} />
          </DrawerTrigger>
          <DrawerContent onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }}>
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
                disabled={creatingTag || !formData.title.trim()}
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
          <DialogContent onEscapeKeyDown={event => { if (creatingTag) event.preventDefault() }} className="min-w-full md:min-w-[650px]">
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
                disabled={creatingTag || !formData.title.trim()}
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
