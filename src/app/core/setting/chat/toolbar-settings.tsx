'use client'

import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  BotMessageSquare,
  Drama,
  Globe,
  Link,
  AtSign,
  ServerCrash,
  Database,
  Clipboard,
  SquareCode,
  GripVertical
} from 'lucide-react'
import useSettingStore, { ChatToolbarItem } from '@/stores/setting'
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

// 工具配置：图标和描述键
const TOOL_CONFIGS = {
  modelSelect: {
    icon: <BotMessageSquare className="size-4" />,
    titleKey: 'record.chat.input.modelSelect.tooltip',
    descKey: 'settings.chat.toolbar.chatToolbar.modelSelect.desc',
  },
  promptSelect: {
    icon: <Drama className="size-4" />,
    titleKey: 'record.chat.input.promptSelect.tooltip',
    descKey: 'settings.chat.toolbar.chatToolbar.promptSelect.desc',
  },
  chatLanguage: {
    icon: <Globe className="size-4" />,
    titleKey: 'record.chat.input.chatLanguage.tooltip',
    descKey: 'settings.chat.toolbar.chatToolbar.chatLanguage.desc',
  },
  chatLink: {
    icon: <Link className="size-4" />,
    titleKey: 'settings.chat.toolbar.chatToolbar.chatLink.title',
    descKey: 'settings.chat.toolbar.chatToolbar.chatLink.desc',
  },
  fileLink: {
    icon: <AtSign className="size-4" />,
    titleKey: 'record.chat.input.fileLink.tooltip',
    descKey: 'settings.chat.toolbar.chatToolbar.fileLink.desc',
  },
  mcpButton: {
    icon: <ServerCrash className="size-4" />,
    titleKey: 'mcp.selectServers',
    descKey: 'settings.chat.toolbar.chatToolbar.mcpButton.desc',
  },
  ragSwitch: {
    icon: <Database className="size-4" />,
    titleKey: 'settings.chat.toolbar.chatToolbar.ragSwitch.title',
    descKey: 'settings.chat.toolbar.chatToolbar.ragSwitch.desc',
  },
  clipboardMonitor: {
    icon: <Clipboard className="size-4" />,
    titleKey: 'settings.chat.toolbar.chatToolbar.clipboardMonitor.title',
    descKey: 'settings.chat.toolbar.chatToolbar.clipboardMonitor.desc',
  },
  newChat: {
    icon: <SquareCode className="size-4" />,
    titleKey: 'record.chat.input.newChat',
    descKey: 'settings.chat.toolbar.chatToolbar.newChat.desc',
  },
}

// 工具栏分组定义
const TOOLBAR_GROUPS = {
  bottom: ['modelSelect', 'promptSelect', 'chatLanguage'],
  topLeft: ['chatLink', 'fileLink', 'mcpButton', 'ragSwitch', 'clipboardMonitor'],
  topRight: ['newChat'],
}

// 可排序的工具栏项组件
interface SortableItemProps {
  item: ChatToolbarItem
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
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-3 p-3 border rounded-lg bg-background hover:bg-accent/50 transition-colors">
        {/* 拖拽句柄 */}
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="size-4 text-muted-foreground" />
        </div>

        {/* 工具图标 */}
        <div className="shrink-0 text-muted-foreground">
          {config.icon}
        </div>

        {/* 标题和描述 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{t(config.titleKey)}</div>
          <div className="text-xs text-muted-foreground truncate">{t(config.descKey)}</div>
        </div>

        {/* 开关 */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Switch
            checked={item.enabled}
            onCheckedChange={() => onToggle(item.id)}
          />
        </div>
      </div>
    </div>
  )
}

export function ToolbarSettings() {
  const t = useTranslations()
  const isMobile = useIsMobile()
  const { chatToolbarConfigPc, setChatToolbarConfigPc, chatToolbarConfigMobile, setChatToolbarConfigMobile } = useSettingStore()

  // 根据设备类型选择配置
  const config = isMobile ? chatToolbarConfigMobile : chatToolbarConfigPc
  const setConfig = isMobile ? setChatToolbarConfigMobile : setChatToolbarConfigPc

  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleToggle = async (id: string) => {
    const newConfig = config.map(item =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    )
    await setConfig(newConfig)
  }

  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = config.findIndex((item) => item.id === active.id)
      const newIndex = config.findIndex((item) => item.id === over.id)
      const newItems = arrayMove(config, oldIndex, newIndex)
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index,
      }))
      await setConfig(updatedItems)
    }
  }

  // 按分组渲染
  const renderGroup = (groupKey: 'bottom' | 'topLeft' | 'topRight', groupTitleKey: string) => {
    const groupItems = config
      .filter(item => TOOLBAR_GROUPS[groupKey].includes(item.id))
      .sort((a, b) => a.order - b.order)

    if (groupItems.length === 0) return null

    return (
      <div key={groupKey} className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground text-left py-1">
          {t(groupTitleKey)}
        </h3>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={groupItems.map(item => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {groupItems.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                config={TOOL_CONFIGS[item.id as keyof typeof TOOL_CONFIGS]}
                onToggle={handleToggle}
                t={t}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <h3 className="text-lg font-semibold">{t('settings.chat.toolbar.title')}</h3>

      {/* PC 端分组展示 */}
      {!isMobile && (
        <>
          {renderGroup('topLeft', 'settings.general.tools.chatToolbar.groups.topLeft')}
          {renderGroup('topRight', 'settings.general.tools.chatToolbar.groups.topRight')}
          {renderGroup('bottom', 'settings.general.tools.chatToolbar.groups.bottom')}
        </>
      )}

      {/* 移动端展示 */}
      {isMobile && (
        <div className="space-y-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={config
                .filter(item => !['modelSelect', 'promptSelect'].includes(item.id))
                .map(item => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {config
                .filter(item => !['modelSelect', 'promptSelect'].includes(item.id))
                .sort((a, b) => a.order - b.order)
                .map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    config={TOOL_CONFIGS[item.id as keyof typeof TOOL_CONFIGS]}
                    onToggle={handleToggle}
                    t={t}
                  />
                ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
