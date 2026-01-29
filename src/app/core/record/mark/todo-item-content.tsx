import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import { updateMark } from "@/db/marks"
import { useState } from "react"
import { CheckSquare, Square, Edit2 } from "lucide-react"
import { cn } from "@/lib/utils"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TodoForm, TodoFormData, Priority } from "./todo-form"

dayjs.extend(relativeTime)

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
}

export function TodoItemContent({ mark }: { mark: Mark }) {
  const t = useTranslations()
  const { fetchMarks } = useMarkStore()
  const { recordTextSize } = useSettingStore()

  const [todoData, setTodoData] = useState<TodoData>(() => {
    try {
      return JSON.parse(mark.content || '{}')
    } catch {
      return {
        title: mark.desc || '',
        description: '',
        completed: false,
        priority: 'medium' as Priority
      }
    }
  })

  // 编辑状态
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<TodoFormData>(() => ({
    title: todoData.title,
    description: todoData.description,
    priority: todoData.priority
  }))

  // 根据文字大小映射行高
  const getLineHeight = (textSize: string) => {
    const heightMap = {
      'xs': 'leading-3',
      'sm': 'leading-4',
      'md': 'leading-5',
      'lg': 'leading-6',
      'xl': 'leading-7'
    }
    return heightMap[textSize as keyof typeof heightMap] || 'leading-4'
  }

  const lineHeight = getLineHeight(recordTextSize)

  // 获取优先级颜色（用于圆点）
  const getPriorityColor = (priority: Priority) => {
    const colors = {
      low: 'bg-green-500',
      medium: 'bg-orange-500',
      high: 'bg-red-500'
    }
    return colors[priority]
  }

  // 切换完成状态
  const handleToggleComplete = async () => {
    const newData = { ...todoData, completed: !todoData.completed }
    setTodoData(newData)

    await updateMark({
      ...mark,
      content: JSON.stringify(newData)
    })

    await fetchMarks()
  }

  // 打开编辑对话框
  const handleOpenEdit = () => {
    setFormData({
      title: todoData.title,
      description: todoData.description,
      priority: todoData.priority
    })
    setIsEditing(true)
  }

  // 保存编辑
  const handleSaveEdit = async () => {
    const newData: TodoData = {
      ...todoData,
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority
    }

    setTodoData(newData)

    await updateMark({
      ...mark,
      desc: formData.title.trim(),
      content: JSON.stringify(newData)
    })

    await fetchMarks()
    setIsEditing(false)
  }

  const priorityDotColor = getPriorityColor(todoData.priority)

  return (
    <>
      <div className="flex-1 pr-10 md:pr-0 group">
        <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
          {/* 待办标签 */}
          <span className="flex items-center gap-1.5 bg-indigo-900 text-white px-1.5 py-0.5 rounded text-xs">
            {t('record.mark.type.todo')}
          </span>

          {/* 优先级圆点 */}
          <span className={cn("w-2 h-2 rounded-full", priorityDotColor)} />

          {/* 编辑按钮 */}
          <button
            onClick={handleOpenEdit}
            className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Edit2 className="w-3 h-3 text-zinc-400" />
          </button>

          {/* 创建时间 */}
          <span className="ml-auto">{dayjs(mark.createdAt).fromNow()}</span>
        </div>

        {/* 待办内容 */}
        <div className="mt-2">
          {/* 标题行 */}
          <div className="flex items-center gap-3">
            {/* 完成状态复选框 */}
            <button
              onClick={handleToggleComplete}
              className="flex-shrink-0 hover:scale-110 transition-transform"
            >
              {todoData.completed ? (
                <CheckSquare className="w-5 h-5 text-green-600" />
              ) : (
                <Square className="w-5 h-5 text-zinc-400" />
              )}
            </button>

            {/* 标题 */}
            <p className={cn(
              `font-medium text-${recordTextSize}`,
              todoData.completed && "line-through text-zinc-500"
            )}>
              {todoData.title}
            </p>
          </div>

          {/* 描述（下一行） */}
          <div className={cn(
            "ml-8 mt-1",
            todoData.completed && "opacity-50"
          )}>
            {/* 描述 */}
            {todoData.description && (
              <p className={cn(
                `text-${recordTextSize} text-zinc-600 line-clamp-2 ${lineHeight}`,
                todoData.completed && "line-through"
              )}>
                {todoData.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 编辑对话框 */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="min-w-full md:min-w-125">
          <DialogHeader>
            <DialogTitle>{t('record.mark.todo.edit')}</DialogTitle>
            <DialogDescription>
              {t('record.mark.todo.editDescription')}
            </DialogDescription>
          </DialogHeader>

          <TodoForm
            mode="edit"
            data={formData}
            onChange={setFormData}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              {t('record.mark.todo.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!formData.title.trim()}>
              {t('record.mark.todo.saveEdit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
