import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useState, useEffect, useCallback, useRef } from "react"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { ArrowDown, ArrowUp, CheckSquare, Minus } from "lucide-react"
import { parseTodoMarkContent } from "./mark-list-item-content"
import type { Priority } from "./todo-form"

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
}

interface TodoEditDialogProps {
  mark: Mark
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TodoEditDialog({ mark, open, onOpenChange }: TodoEditDialogProps) {
  const t = useTranslations()
  const { updateMark } = useMarkStore()
  const { fetchTags, getCurrentTag } = useTagStore()

  const [todoData, setTodoData] = useState<TodoData>(() => parseTodoMarkContent(mark))
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open && mark) {
      setTodoData(parseTodoMarkContent(mark))
    }
  }, [open, mark])

  const persistTodoData = useCallback(async (nextTodoData: TodoData) => {
    setTodoData(nextTodoData)
    await updateMark({
      ...mark,
      desc: nextTodoData.title.trim(),
      content: JSON.stringify(nextTodoData)
    })

    await fetchTags()
    getCurrentTag()
  }, [fetchTags, getCurrentTag, mark, updateMark])

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
  }, [])

  const handleAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
    if (!open || event.currentTarget.dataset.state !== 'open') return

    titleInputRef.current?.focus()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="min-w-full md:min-w-[550px]"
        onOpenAutoFocus={handleOpenAutoFocus}
        onAnimationEnd={handleAnimationEnd}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            {t('record.mark.type.todo')}
          </DialogTitle>
          <DialogDescription>
            {t('record.mark.todo.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-todo-title">{t('record.mark.todo.title')} *</Label>
            <Input
              ref={titleInputRef}
              id="edit-todo-title"
              value={todoData.title}
              onChange={(e) => void persistTodoData({ ...todoData, title: e.target.value })}
              placeholder={t('record.mark.todo.titlePlaceholder')}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="edit-todo-description">{t('record.mark.todo.description')}</Label>
            <Textarea
              id="edit-todo-description"
              rows={3}
              maxRows={8}
              value={todoData.description}
              onChange={(e) => void persistTodoData({ ...todoData, description: e.target.value })}
              placeholder={t('record.mark.todo.descriptionPlaceholder')}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="edit-todo-priority">{t('record.mark.todo.priority')}</Label>
            <Tabs
              id="edit-todo-priority"
              orientation="horizontal"
              value={todoData.priority}
              onValueChange={(value) => void persistTodoData({ ...todoData, priority: value as Priority })}
              className="mt-1.5"
            >
              <TabsList className="w-full group-data-vertical/tabs:h-8 group-data-vertical/tabs:flex-row">
                <TabsTrigger
                  value="low"
                  className="group-data-vertical/tabs:w-auto group-data-vertical/tabs:justify-center"
                >
                  <ArrowDown data-icon="inline-start" />
                  {t('record.mark.todo.priorityLow')}
                </TabsTrigger>
                <TabsTrigger
                  value="medium"
                  className="group-data-vertical/tabs:w-auto group-data-vertical/tabs:justify-center"
                >
                  <Minus data-icon="inline-start" />
                  {t('record.mark.todo.priorityMedium')}
                </TabsTrigger>
                <TabsTrigger
                  value="high"
                  className="group-data-vertical/tabs:w-auto group-data-vertical/tabs:justify-center"
                >
                  <ArrowUp data-icon="inline-start" />
                  {t('record.mark.todo.priorityHigh')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
