"use client"
import { useTranslations } from 'next-intl'
import * as React from "react"
import { initMarksDb } from "@/db/marks"
import { ControlScan } from "./control-scan"
import { ControlText } from "./control-text"
import { ControlImage } from "./control-image"
import { ControlFile } from "./control-file"
import { ControlLink } from "./control-link"
import { ControlRecording } from "./control-recording"
import { ControlTodo } from "./control-todo"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from '@/components/ui/tooltip'
import { Menu, Trash2, XCircle } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export function MarkHeader() {
  const t = useTranslations('record.mark');
  const { trashState, setTrashState, fetchAllTrashMarks, fetchMarks } = useMarkStore()
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()

  // 拖拽传感器配置（仅桌面端）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 500, // 按住500ms后才开始拖拽，避免误触点击事件
        tolerance: 5, // 允许5px的移动误差
      },
    })
  )

  // 处理拖拽结束
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = recordToolbarConfig.findIndex((item) => item.id === active.id)
      const newIndex = recordToolbarConfig.findIndex((item) => item.id === over.id)
      
      const newItems = arrayMove(recordToolbarConfig, oldIndex, newIndex)
      // 更新 order
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index
      }))
      setRecordToolbarConfig(updatedItems)
    }
  }

  React.useEffect(() => {
    initMarksDb()
  }, [])

  React.useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchMarks()
    }
  }, [trashState])

  return (
    <div className="flex justify-between items-center h-12 border-b px-2">
      {/* 工具栏 */}
      <div className="flex">
        <TooltipProvider>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={recordToolbarConfig.filter(item => item.enabled).map(item => item.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex">
                {recordToolbarConfig
                  .filter(item => item.enabled)
                  .sort((a, b) => a.order - b.order)
                  .map(item => (
                    <SortableToolbarItem key={item.id} id={item.id} />
                  ))}
              </div>
            </SortableContext>
          </DndContext>
        </TooltipProvider>
      </div>

      {/* 菜单按钮 */}
      <div className="flex items-center gap-1">
        {trashState ? (
          <Button variant="ghost" size="icon" onClick={() => setTrashState(false)}>
            <XCircle />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTrashState(true)}>
                <Trash2 />{t('toolbar.trash')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// 可排序的工具栏项组件
interface SortableToolbarItemProps {
  id: string
}

function SortableToolbarItem({ id }: SortableToolbarItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // 渲染对应的工具栏组件
  const renderToolbarItem = () => {
    switch (id) {
      case 'text':
        return <ControlText />
      case 'recording':
        return <ControlRecording />
      case 'scan':
        return <ControlScan />
      case 'image':
        return <ControlImage />
      case 'link':
        return <ControlLink />
      case 'file':
        return <ControlFile />
      case 'todo':
        return <ControlTodo />
      default:
        return null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      {renderToolbarItem()}
    </div>
  )
}
