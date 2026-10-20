import { Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
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

export function TodoItemContent({ mark, interactive = true }: { mark: Mark, interactive?: boolean }) {
  const t = useTranslations()
  const { updateMark } = useMarkStore()
  const { recordTextSize } = useSettingStore()

  const [todoData, setTodoData] = useState<TodoData>(() => {
    return parseTodoMarkContent(mark)
  })

  useEffect(() => {
    setTodoData(parseTodoMarkContent(mark))
  }, [mark])

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

  const getLineHeightRem = (textSize: string) => {
    const heightMap = {
      'xs': 0.75,
      'sm': 1,
      'md': 1.25,
      'lg': 1.5,
      'xl': 1.75
    }
    return heightMap[textSize as keyof typeof heightMap] || 1
  }

  const lineHeight = getLineHeight(recordTextSize)
  const lineHeightRem = getLineHeightRem(recordTextSize)

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
    if (!interactive) return

    const newData = { ...todoData, completed: !todoData.completed }
    setTodoData(newData)

    await updateMark({
      ...mark,
      content: JSON.stringify(newData)
    })
  }

  const priorityDotColor = getPriorityColor(todoData.priority)
  const descriptionClampStyle: CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    maxHeight: `${lineHeightRem * 4}rem`,
    overflow: 'hidden',
  }

  return (
    <>
      <div className="group min-w-0 max-w-full flex-1 overflow-hidden pr-10 md:pr-0">
        <div className={`flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden text-zinc-500 text-${recordTextSize} ${lineHeight}`}>
          <span className={cn(getMarkTypeListBadgeClasses(mark.type, 'xs'), 'shrink-0')}>
            {t('record.mark.type.todo')}
          </span>

          {/* 优先级圆点 */}
          <span className={cn("h-2 w-2 shrink-0 rounded-full", priorityDotColor)} />
          {/* 创建时间 */}
          <span className="ml-auto shrink-0">{dayjs(mark.createdAt).fromNow()}</span>
        </div>

        {/* 待办内容 */}
        <div className="mt-2 min-w-0 max-w-full overflow-hidden">
          <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden">
            {/* 完成状态复选框 */}
            <button
              onClick={handleToggleComplete}
              disabled={!interactive}
              className={cn("flex-shrink-0 transition-transform", interactive && "hover:scale-110")}
            >
              {todoData.completed ? (
                <CheckSquare className="w-5 h-5 text-green-600" />
              ) : (
                <Square className="w-5 h-5 text-zinc-400" />
              )}
            </button>

            {interactive ? (
              <TodoEditTrigger mark={mark} className="block min-w-0 max-w-full flex-1 overflow-hidden">
                <p className={cn(
                  `break-words font-medium text-${recordTextSize} [overflow-wrap:anywhere]`,
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
                      `break-words text-${recordTextSize} ${lineHeight} text-muted-foreground [overflow-wrap:anywhere]`,
                      todoData.completed && "line-through"
                    )}
                    style={descriptionClampStyle}>
                      {todoData.description}
                    </p>
                  </div>
                )}
              </TodoEditTrigger>
            ) : (
              <div className="min-w-0 max-w-full flex-1 overflow-hidden">
                <p className={cn(
                  `break-words font-medium text-${recordTextSize} [overflow-wrap:anywhere]`,
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
                      `break-words text-${recordTextSize} ${lineHeight} text-muted-foreground [overflow-wrap:anywhere]`,
                      todoData.completed && "line-through"
                    )}
                    style={descriptionClampStyle}>
                      {todoData.description}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
