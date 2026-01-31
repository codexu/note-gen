import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "next-intl"

export type Priority = 'low' | 'medium' | 'high'

export interface TodoFormData {
  title: string
  description: string
  priority: Priority
}

interface TodoFormProps {
  mode: 'create' | 'edit'
  data: TodoFormData
  onChange: (data: TodoFormData) => void
  selectedTagId?: number
  onTagChange?: (tagId: number) => void
  tags?: Array<{ id: number; name: string }>
  showTagSelector?: boolean
}

export function TodoForm({
  mode,
  data,
  onChange,
  selectedTagId,
  onTagChange,
  tags = [],
  showTagSelector = false,
}: TodoFormProps) {
  const t = useTranslations()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // 父组件处理保存
    } else if (e.key === 'Escape') {
      // 父组件处理关闭
    }
  }

  return (
    <div className="space-y-4">
      {showTagSelector && onTagChange && (
        <div>
          <Label htmlFor="todo-tag">{t('record.mark.todo.selectTag')}</Label>
          <Select value={String(selectedTagId)} onValueChange={(value) => onTagChange(Number(value))}>
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
      )}

      <div>
        <Label htmlFor={`todo-title-${mode}`}>{t('record.mark.todo.title')} *</Label>
        <Input
          id={`todo-title-${mode}`}
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
          placeholder={t('record.mark.todo.titlePlaceholder')}
          onKeyDown={handleKeyDown}
          autoFocus
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor={`todo-description-${mode}`}>{t('record.mark.todo.description')}</Label>
        <Textarea
          id={`todo-description-${mode}`}
          rows={3}
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
          placeholder={t('record.mark.todo.descriptionPlaceholder')}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor={`todo-priority-${mode}`}>{t('record.mark.todo.priority')}</Label>
        <Tabs value={data.priority} onValueChange={(value) => onChange({ ...data, priority: value as Priority })} className="mt-1.5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="low" className="gap-2 data-[state=active]:bg-accent">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {t('record.mark.todo.priorityLow')}
            </TabsTrigger>
            <TabsTrigger value="medium" className="gap-2 data-[state=active]:bg-accent">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              {t('record.mark.todo.priorityMedium')}
            </TabsTrigger>
            <TabsTrigger value="high" className="gap-2 data-[state=active]:bg-accent">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {t('record.mark.todo.priorityHigh')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
