'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import useSettingStore, { RecordToolbarItem } from '@/stores/setting'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
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
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SettingSection } from '../components/setting-base'

// 工具配置：图标和描述键
const TOOL_CONFIGS = {
  text: {
    icon: <CopySlash />,
    titleKey: 'record.mark.toolbar.text',
    descKey: 'settings.record.toolbar.recordToolbar.text.desc',
  },
  recording: {
    icon: <Mic />,
    titleKey: 'record.mark.toolbar.recording',
    descKey: 'settings.record.toolbar.recordToolbar.recording.desc',
  },
  scan: {
    icon: <ScanLine />,
    titleKey: 'record.mark.toolbar.scan',
    descKey: 'settings.record.toolbar.recordToolbar.scan.desc',
  },
  image: {
    icon: <ImagePlus />,
    titleKey: 'record.mark.toolbar.image',
    descKey: 'settings.record.toolbar.recordToolbar.image.desc',
  },
  link: {
    icon: <Link2 />,
    titleKey: 'record.mark.toolbar.link',
    descKey: 'settings.record.toolbar.recordToolbar.link.desc',
  },
  file: {
    icon: <FileText />,
    titleKey: 'record.mark.toolbar.file',
    descKey: 'settings.record.toolbar.recordToolbar.file.desc',
  },
  todo: {
    icon: <CheckSquare />,
    titleKey: 'record.mark.toolbar.todo',
    descKey: 'settings.record.toolbar.recordToolbar.todo.desc',
  },
}

// 可排序的工具栏项组件
interface SortableItemProps {
  item: RecordToolbarItem
  config: typeof TOOL_CONFIGS[keyof typeof TOOL_CONFIGS]
  onToggle: (id: string) => void
  t: (key: string) => string
}

function SortableItem({ item, config, onToggle, t }: SortableItemProps) {
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
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} role="listitem" className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        {...attributes}
        {...listeners}
        aria-label={`${t('common.sort')} ${config ? t(config.titleKey) : item.id}`}
        className="absolute top-1/2 left-1 -translate-y-1/2 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground focus-visible:text-muted-foreground active:cursor-grabbing sm:right-full sm:left-auto sm:mr-1"
      >
        <GripVertical />
      </Button>
      <Item variant="outline" className="pl-11 sm:pl-3">
        <ItemMedia variant="icon" className="text-muted-foreground">
          {config?.icon}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{config ? t(config.titleKey) : item.id}</ItemTitle>
          <ItemDescription className="line-clamp-1">{config ? t(config.descKey) : ''}</ItemDescription>
        </ItemContent>
        <ItemActions className="mobile-setting-inline-action" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={item.enabled}
            onCheckedChange={() => onToggle(item.id)}
          />
        </ItemActions>
      </Item>
    </div>
  )
}

export function ToolbarSettings() {
  const t = useTranslations()
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()

  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleToggle = async (id: string) => {
    const newConfig = recordToolbarConfig.map(item =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    )
    await setRecordToolbarConfig(newConfig)
  }

  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = recordToolbarConfig.findIndex((item) => item.id === active.id)
      const newIndex = recordToolbarConfig.findIndex((item) => item.id === over.id)
      const newItems = arrayMove(recordToolbarConfig, oldIndex, newIndex)
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index,
      }))
      await setRecordToolbarConfig(updatedItems)
    }
  }

  // 按排序展示工具（过滤掉不在 TOOL_CONFIGS 中的项）
  const sortedConfig = [...recordToolbarConfig]
    .filter(item => item.id in TOOL_CONFIGS)
    .sort((a, b) => a.order - b.order)

  return (
    <SettingSection
      title={t('settings.record.toolbar.title')}
      desc={t('settings.record.toolbar.recordToolbar.desc')}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedConfig.map(item => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ItemGroup className="gap-2">
            {sortedConfig.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                config={TOOL_CONFIGS[item.id as keyof typeof TOOL_CONFIGS]}
                onToggle={handleToggle}
                t={t}
              />
            ))}
          </ItemGroup>
        </SortableContext>
      </DndContext>
    </SettingSection>
  )
}
