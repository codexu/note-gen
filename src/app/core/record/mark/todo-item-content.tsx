import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import { Checkbox } from "@/components/ui/checkbox"
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import { updateMark } from "@/db/marks"
import { useState } from "react"
import { CheckSquare, Square, Calendar as CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"

dayjs.extend(relativeTime)

type Priority = 'low' | 'medium' | 'high'

interface TodoData {
  title: string
  description: string
  completed: boolean
  priority: Priority
  dueDate?: string
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

  // 获取优先级颜色
  const getPriorityColor = (priority: Priority) => {
    const colors = {
      low: 'bg-green-800',
      medium: 'bg-orange-700',
      high: 'bg-red-900'
    }
    return colors[priority]
  }

  // 获取优先级标签
  const getPriorityLabel = (priority: Priority) => {
    const labels = {
      low: t('record.mark.todo.priorityLow'),
      medium: t('record.mark.todo.priorityMedium'),
      high: t('record.mark.todo.priorityHigh')
    }
    return labels[priority]
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

  const priorityColor = getPriorityColor(todoData.priority)
  const priorityLabel = getPriorityLabel(todoData.priority)

  return (
    <div className="flex-1 pr-10 md:pr-0">
      <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
        {/* 优先级标签 */}
        <span className={cn(
          "flex items-center gap-1 text-white px-1.5 py-0.5 rounded text-xs",
          priorityColor
        )}>
          {priorityLabel}
        </span>

        {/* 创建时间 */}
        <span className="ml-auto">{dayjs(mark.createdAt).fromNow()}</span>
      </div>

      {/* 待办内容 */}
      <div className="mt-2">
        <div className="flex items-start gap-3">
          {/* 完成状态复选框 */}
          <button
            onClick={handleToggleComplete}
            className="flex-shrink-0 mt-0.5 hover:scale-110 transition-transform"
          >
            {todoData.completed ? (
              <CheckSquare className="w-5 h-5 text-green-600" />
            ) : (
              <Square className="w-5 h-5 text-zinc-400" />
            )}
          </button>

          {/* 标题和描述 */}
          <div className={cn(
            "flex-1 min-w-0",
            todoData.completed && "opacity-50"
          )}>
            {/* 标题 */}
            <p className={cn(
              `font-medium text-${recordTextSize}`,
              todoData.completed && "line-through text-zinc-500"
            )}>
              {todoData.title}
            </p>

            {/* 描述 */}
            {todoData.description && (
              <p className={cn(
                `mt-1 text-${recordTextSize} text-zinc-600 line-clamp-2 ${lineHeight}`,
                todoData.completed && "line-through"
              )}>
                {todoData.description}
              </p>
            )}

            {/* 截止日期 */}
            {todoData.dueDate && (
              <div className={cn(
                "flex items-center gap-1 mt-2 text-xs text-zinc-500",
                todoData.completed && "line-through"
              )}>
                <CalendarIcon className="w-3.5 h-3.5" />
                {t('record.mark.todo.dueDate')}: {todoData.dueDate}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
