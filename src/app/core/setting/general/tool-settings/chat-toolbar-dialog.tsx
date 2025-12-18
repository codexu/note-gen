'use client'

import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import useSettingStore, { ChatToolbarItem } from '@/stores/setting'
import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { 
  BotMessageSquare, 
  Drama, 
  Languages, 
  Link2, 
  FileText, 
  ServerCrash, 
  BookOpen, 
  Lightbulb, 
  Clipboard, 
  Eraser, 
  Trash2,
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

interface ChatToolbarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 工具配置映射
const TOOL_CONFIG_MAP: Record<string, { icon: React.ReactNode; labelKey: string }> = {
  modelSelect: { icon: <BotMessageSquare className="size-4" />, labelKey: 'modelSelect.tooltip' },
  promptSelect: { icon: <Drama className="size-4" />, labelKey: 'promptSelect.tooltip' },
  chatLanguage: { icon: <Languages className="size-4" />, labelKey: 'chatLanguage.tooltip' },
  chatLink: { icon: <Link2 className="size-4" />, labelKey: 'tagLink.on' },
  fileLink: { icon: <FileText className="size-4" />, labelKey: 'fileLink.tooltip' },
  mcpButton: { icon: <ServerCrash className="size-4" />, labelKey: 'mcp.tooltip' },
  ragSwitch: { icon: <BookOpen className="size-4" />, labelKey: 'rag.enabled' },
  chatPlaceholder: { icon: <Lightbulb className="size-4" />, labelKey: 'placeholder.on' },
  clipboardMonitor: { icon: <Clipboard className="size-4" />, labelKey: 'clipboardMonitor.enable' },
  clearContext: { icon: <Eraser className="size-4" />, labelKey: 'clearContext.tooltip' },
  clearChat: { icon: <Trash2 className="size-4" />, labelKey: 'clearChat' },
}

// 工具栏分组定义
const TOOLBAR_GROUPS = {
  bottom: ['modelSelect', 'promptSelect', 'chatLanguage'],
  topLeft: ['chatLink', 'fileLink', 'mcpButton', 'ragSwitch', 'chatPlaceholder', 'clipboardMonitor'],
  topRight: ['clearContext', 'clearChat'],
}

export function ChatToolbarDialog({ open, onOpenChange }: ChatToolbarDialogProps) {
  const t = useTranslations()
  const tChat = useTranslations('record.chat.input')
  const isMobile = useIsMobile()
  const { chatToolbarConfigPc, setChatToolbarConfigPc, chatToolbarConfigMobile, setChatToolbarConfigMobile } = useSettingStore()
  const [localConfigPc, setLocalConfigPc] = useState<ChatToolbarItem[]>([])
  const [localConfigMobile, setLocalConfigMobile] = useState<ChatToolbarItem[]>([])

  useEffect(() => {
    if (open) {
      // 打开抽屉时，加载当前配置
      setLocalConfigPc([...chatToolbarConfigPc].sort((a, b) => a.order - b.order))
      setLocalConfigMobile([...chatToolbarConfigMobile].sort((a, b) => a.order - b.order))
    }
  }, [open, chatToolbarConfigPc, chatToolbarConfigMobile])

  // 自动保存配置 - PC
  const autoSavePc = async (newConfig: ChatToolbarItem[]) => {
    await setChatToolbarConfigPc(newConfig)
  }

  // 自动保存配置 - 移动端
  const autoSaveMobile = async (newConfig: ChatToolbarItem[]) => {
    await setChatToolbarConfigMobile(newConfig)
  }

  const handleTogglePc = (id: string) => {
    setLocalConfigPc(prev => {
      const newConfig = prev.map(item => 
        item.id === id ? { ...item, enabled: !item.enabled } : item
      )
      autoSavePc(newConfig)
      return newConfig
    })
  }

  const handleToggleMobile = (id: string) => {
    setLocalConfigMobile(prev => {
      const newConfig = prev.map(item => 
        item.id === id ? { ...item, enabled: !item.enabled } : item
      )
      autoSaveMobile(newConfig)
      return newConfig
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEndPc = (group: 'bottom' | 'topLeft' | 'topRight') => (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setLocalConfigPc((items) => {
        const groupItems = items.filter(item => TOOLBAR_GROUPS[group].includes(item.id))
        const oldIndex = groupItems.findIndex((item) => item.id === active.id)
        const newIndex = groupItems.findIndex((item) => item.id === over.id)
        const reorderedGroupItems = arrayMove(groupItems, oldIndex, newIndex)
        const allItems = [...items]
        reorderedGroupItems.forEach((item, index) => {
          const globalIndex = allItems.findIndex(i => i.id === item.id)
          if (globalIndex !== -1) {
            allItems[globalIndex] = { ...item, order: groupItems[0].order + index }
          }
        })
        autoSavePc(allItems)
        return allItems
      })
    }
  }

  const handleDragEndMobile = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setLocalConfigMobile((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)
        const newItems = arrayMove(items, oldIndex, newIndex)
        const updatedItems = newItems.map((item, index) => ({
          ...item,
          order: index
        }))
        autoSaveMobile(updatedItems)
        return updatedItems
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full sm:!w-[520px] !max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('settings.general.tools.chatToolbar.dialogTitle')}</SheetTitle>
          <SheetDescription>
            {t('settings.general.tools.chatToolbar.dialogDesc')}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* PC 端工具栏 */}
          {!isMobile && (
          <div className="space-y-4">
            {/* 顶部工具栏 - 左侧 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('settings.general.tools.chatToolbar.groups.topLeft')}
              </h4>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndPc('topLeft')}
              >
                <SortableContext
                  items={localConfigPc.filter(item => TOOLBAR_GROUPS.topLeft.includes(item.id)).map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localConfigPc
                    .filter(item => TOOLBAR_GROUPS.topLeft.includes(item.id))
                    .map((item) => (
                      <SortableToolItem
                        key={item.id}
                        item={item}
                        config={TOOL_CONFIG_MAP[item.id]}
                        onToggle={handleTogglePc}
                        tChat={tChat}
                      />
                    ))}
                </SortableContext>
              </DndContext>
            </div>

            {/* 顶部工具栏 - 右侧 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('settings.general.tools.chatToolbar.groups.topRight')}
              </h4>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndPc('topRight')}
              >
                <SortableContext
                  items={localConfigPc.filter(item => TOOLBAR_GROUPS.topRight.includes(item.id)).map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localConfigPc
                    .filter(item => TOOLBAR_GROUPS.topRight.includes(item.id))
                    .map((item) => (
                      <SortableToolItem
                        key={item.id}
                        item={item}
                        config={TOOL_CONFIG_MAP[item.id]}
                        onToggle={handleTogglePc}
                        tChat={tChat}
                      />
                    ))}
                </SortableContext>
              </DndContext>
            </div>

            {/* 底部工具栏 */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t('settings.general.tools.chatToolbar.groups.bottom')}
              </h4>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndPc('bottom')}
              >
                <SortableContext
                  items={localConfigPc.filter(item => TOOLBAR_GROUPS.bottom.includes(item.id)).map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localConfigPc
                    .filter(item => TOOLBAR_GROUPS.bottom.includes(item.id))
                    .map((item) => (
                      <SortableToolItem
                        key={item.id}
                        item={item}
                        config={TOOL_CONFIG_MAP[item.id]}
                        onToggle={handleTogglePc}
                        tChat={tChat}
                      />
                    ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
          )}

          {/* 移动端工具栏 */}
          {isMobile && (
          <div className="space-y-4">
            <div className="space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndMobile}
              >
                <SortableContext
                  items={localConfigMobile.filter(item => !['modelSelect', 'promptSelect'].includes(item.id)).map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localConfigMobile
                    .filter(item => !['modelSelect', 'promptSelect'].includes(item.id))
                    .map((item) => (
                    <SortableToolItem
                      key={item.id}
                      item={item}
                      config={TOOL_CONFIG_MAP[item.id]}
                      onToggle={handleToggleMobile}
                      tChat={tChat}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface SortableToolItemProps {
  item: ChatToolbarItem
  config: { icon: React.ReactNode; labelKey: string } | undefined
  onToggle: (id: string) => void
  tChat: any
}

function SortableToolItem({ item, config, onToggle, tChat }: SortableToolItemProps) {
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
          {tChat(config.labelKey as any)}
        </span>
      </div>

      <Switch
        checked={item.enabled}
        onCheckedChange={() => onToggle(item.id)}
      />
    </div>
  )
}
