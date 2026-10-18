import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RecordSaveTarget } from "./record-save-target"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"

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
  autoFocus?: boolean
  titleInputRef?: React.Ref<HTMLInputElement>
  selectedTagId?: number
  onTagChange?: (tagId: number) => void
  tags?: Array<{ id: number; name: string }>
  showTagSelector?: boolean
  onCreatingTagChange?: (creating: boolean) => void
  onSubmit?: () => void
  onCancel?: () => void
}

export function TodoForm({
  mode,
  data,
  onChange,
  autoFocus = true,
  titleInputRef,
  selectedTagId,
  onTagChange,
  tags = [],
  showTagSelector = false,
  onCreatingTagChange,
  onSubmit,
  onCancel,
}: TodoFormProps) {
  const t = useTranslations()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit?.()
    } else if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  return (
    <div className="space-y-4">
      {showTagSelector && onTagChange && (
        <RecordSaveTarget
          selectedTagId={selectedTagId ?? 0}
          tags={tags}
          onTagChange={onTagChange}
          onCreatingChange={onCreatingTagChange}
        />
      )}

      <div>
        <Label htmlFor={`todo-title-${mode}`}>{t('record.mark.todo.title')} *</Label>
        <Input
          ref={titleInputRef}
          id={`todo-title-${mode}`}
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
          placeholder={t('record.mark.todo.titlePlaceholder')}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor={`todo-description-${mode}`}>{t('record.mark.todo.description')}</Label>
        <Textarea
          id={`todo-description-${mode}`}
          rows={3}
          maxRows={8}
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
          placeholder={t('record.mark.todo.descriptionPlaceholder')}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label htmlFor={`todo-priority-${mode}`}>{t('record.mark.todo.priority')}</Label>
        <Tabs
          id={`todo-priority-${mode}`}
          orientation="horizontal"
          value={data.priority}
          onValueChange={(value) => onChange({ ...data, priority: value as Priority })}
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
  )
}
