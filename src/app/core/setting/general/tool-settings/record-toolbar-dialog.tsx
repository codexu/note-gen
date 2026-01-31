'use client'

import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import useSettingStore, { RecordToolbarItem } from '@/stores/setting'
import { useEffect, useState } from 'react'
import {
  CopySlash,
  Mic,
  ScanLine,
  ImagePlus,
  Link2,
  FileText,
  CheckSquare,
  GripVertical
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface RecordToolbarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 工具配置映射
const TOOL_CONFIG_MAP: Record<string, { icon: React.ReactNode; labelKey: string }> = {
  text: { icon: <CopySlash className="size-4" />, labelKey: 'text' },
  recording: { icon: <Mic className="size-4" />, labelKey: 'recording' },
  scan: { icon: <ScanLine className="size-4" />, labelKey: 'scan' },
  image: { icon: <ImagePlus className="size-4" />, labelKey: 'image' },
  link: { icon: <Link2 className="size-4" />, labelKey: 'link' },
  file: { icon: <FileText className="size-4" />, labelKey: 'file' },
  todo: { icon: <CheckSquare className="size-4" />, labelKey: 'todo' },
}

export function RecordToolbarDialog({ open, onOpenChange }: RecordToolbarDialogProps) {
  const t = useTranslations()
  const tRecord = useTranslations('record.mark.toolbar')
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()
  const [localConfig, setLocalConfig] = useState<RecordToolbarItem[]>([])

  useEffect(() => {
    if (open) {
      // 打开抽屉时，加载当前配置
      setLocalConfig([...recordToolbarConfig].sort((a, b) => a.order - b.order))
    }
  }, [open, recordToolbarConfig])

  // 自动保存配置
  const autoSave = async (newConfig: RecordToolbarItem[]) => {
    await setRecordToolbarConfig(newConfig)
  }

  const handleToggle = (id: string) => {
    setLocalConfig(prev => {
      const newConfig = prev.map(item => 
        item.id === id ? { ...item, enabled: !item.enabled } : item
      )
      // 自动保存
      autoSave(newConfig)
      return newConfig
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setLocalConfig((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        
        const newItems = arrayMove(items, oldIndex, newIndex)
        // 更新 order
        const updatedItems = newItems.map((item, index) => ({
          ...item,
          order: index
        }))
        // 自动保存
        autoSave(updatedItems)
        return updatedItems
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full sm:!w-[520px] !max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('settings.general.tools.recordToolbar.dialogTitle')}</SheetTitle>
          <SheetDescription>
            {t('settings.general.tools.recordToolbar.dialogDesc')}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 mt-6">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localConfig.map(item => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {localConfig.map((item) => (
                <SortableToolItem
                  key={item.id}
                  item={item}
                  config={TOOL_CONFIG_MAP[item.id]}
                  onToggle={handleToggle}
                  tRecord={tRecord}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface SortableToolItemProps {
  item: RecordToolbarItem
  config: { icon: React.ReactNode; labelKey: string } | undefined
  onToggle: (id: string) => void
  tRecord: any
}

function SortableToolItem({ item, config, onToggle, tRecord }: SortableToolItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  if (!config) return null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 border rounded-lg ${
        isDragging ? 'bg-accent opacity-50' : 'bg-background'
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </div>
      
      <div className="flex items-center gap-2 flex-1">
        {config.icon}
        <span className="text-sm">
          {tRecord(config.labelKey as any)}
        </span>
      </div>

      <Switch
        checked={item.enabled}
        onCheckedChange={() => onToggle(item.id)}
      />
    </div>
  )
}
