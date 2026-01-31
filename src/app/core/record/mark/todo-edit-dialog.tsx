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
import { useState, useEffect } from "react"
import { updateMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { CheckSquare } from "lucide-react"

type Priority = 'low' | 'medium' | 'high'

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
  const { fetchMarks } = useMarkStore()
  const { fetchTags, getCurrentTag } = useTagStore()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')

  useEffect(() => {
    if (open && mark) {
      try {
        const todoData: TodoData = JSON.parse(mark.content || '{}')
        setTitle(todoData.title || '')
        setDescription(todoData.description || '')
        setPriority(todoData.priority || 'medium')
      } catch {
        setTitle(mark.desc || '')
        setDescription('')
        setPriority('medium')
      }
    }
  }, [open, mark])

  async function handleSave() {
    if (!title.trim()) {
      return
    }

    const todoData: TodoData = {
      title: title.trim(),
      description: description.trim(),
      priority,
      completed: false // 编辑后重置完成状态
    }

    await updateMark({
      ...mark,
      desc: title.trim(),
      content: JSON.stringify(todoData)
    })

    await fetchMarks()
    await fetchTags()
    getCurrentTag()

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-full md:min-w-[550px]">
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
              id="edit-todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('record.mark.todo.titlePlaceholder')}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="edit-todo-description">{t('record.mark.todo.description')}</Label>
            <Textarea
              id="edit-todo-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('record.mark.todo.descriptionPlaceholder')}
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="edit-todo-priority">{t('record.mark.todo.priority')}</Label>
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!title.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
