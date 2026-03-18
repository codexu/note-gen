import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import { updateMark } from "@/db/marks"
import { useState } from "react"
import { CheckSquare, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import { getMarkTypeListBadgeClasses } from "./mark-type-meta"
import { parseTodoMarkContent } from "./mark-list-item-content"
import { TodoEditTrigger } from "./todo-edit-button"
import { Priority } from "./todo-form"

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
    return parseTodoMarkContent(mark)
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

  const priorityDotColor = getPriorityColor(todoData.priority)

  return (
    <>
      <div className="flex-1 pr-10 md:pr-0 group">
        <div className={`flex w-full items-center gap-2 text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
          <span className={getMarkTypeListBadgeClasses(mark.type, 'xs')}>
            {t('record.mark.type.todo')}
          </span>

          {/* 优先级圆点 */}
          <span className={cn("w-2 h-2 rounded-full", priorityDotColor)} />
          {/* 创建时间 */}
          <span className="ml-auto">{dayjs(mark.createdAt).fromNow()}</span>
        </div>

        {/* 待办内容 */}
        <div className="mt-2">
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

            <TodoEditTrigger mark={mark} className="min-w-0 flex-1">
              <p className={cn(
                `font-medium text-${recordTextSize}`,
                todoData.completed && "line-through text-zinc-500"
              )}>
                {todoData.title}
              </p>
              {todoData.description && (
                <div className={cn(
                  "mt-1",
                  todoData.completed && "opacity-50"
                )}>
                  <p className={cn(
                    `text-${recordTextSize} text-muted-foreground line-clamp-2 ${lineHeight}`,
                    todoData.completed && "line-through"
                  )}>
                    {todoData.description}
                  </p>
                </div>
              )}
            </TodoEditTrigger>
          </div>
        </div>
      </div>
    </>
  )
}
