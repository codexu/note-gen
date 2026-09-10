'use client'

import type { Editor } from '@tiptap/core'
import { PluginIcon } from '@/components/plugins/plugin-icon'
import { usePluginEditorCommands } from '@/components/plugins/use-plugin-editor-commands'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  executePluginCommand,
  type RegisteredPluginCommand,
} from '@/lib/plugins/command-registry'
import { toast } from '@/hooks/use-toast'

type MobileSheetMode =
  | 'insert'
  | 'format'
  | 'ai'
  | 'ai-write'
  | 'ai-custom'
  | 'mobile-more'
  | 'image-src'
  | 'image-alt'
  | 'table-align'
  | 'table-more'
  | null

interface MobileEditorMoreSheetProps {
  editor?: Editor | null
  pluginsEnabled?: boolean
  open: boolean
  mode: MobileSheetMode
  imageSrc: string
  imageAlt: string
  customAiInstruction: string
  onOpenChange: (open: boolean) => void
  onImageSrcChange: (value: string) => void
  onImageAltChange: (value: string) => void
  onCustomAiInstructionChange: (value: string) => void
  onSubmitImageSrc: () => void
  onSubmitImageAlt: () => void
  onSubmitCustomAiInstruction: () => void
  onAction: (action: string) => void
}

function ActionButton({
  label,
  description,
  onClick,
  destructive = false,
  icon,
  disabled,
}: {
  label: string
  description?: string
  onClick: () => void
  destructive?: boolean
  icon?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`w-full rounded-xl border px-3 py-3 text-left ${destructive ? 'border-destructive/30 text-destructive' : 'border-border text-foreground'}`}
      onClick={onClick}
    >
      <span className="flex items-center gap-2 text-sm font-medium">{icon ? <PluginIcon name={icon} className="size-4" /> : null}{label}</span>
      {description ? <span className="mt-1 block text-xs text-muted-foreground">{description}</span> : null}
    </button>
  )
}

export function MobileEditorMoreSheet({
  editor,
  pluginsEnabled = false,
  open,
  mode,
  imageSrc,
  imageAlt,
  customAiInstruction,
  onOpenChange,
  onImageSrcChange,
  onImageAltChange,
  onCustomAiInstructionChange,
  onSubmitImageSrc,
  onSubmitImageAlt,
  onSubmitCustomAiInstruction,
  onAction,
}: MobileEditorMoreSheetProps) {
  const contributions = usePluginEditorCommands('mobile/writing/overflow', editor)
  const pluginCommands = pluginsEnabled ? contributions : []

  const runPluginCommand = (command: RegisteredPluginCommand) => {
    onOpenChange(false)
    void executePluginCommand(command.id).catch((error) => {
      toast({
        title: command.title,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    })
  }

  const titleMap: Record<Exclude<MobileSheetMode, null>, string> = {
    insert: '插入内容',
    format: '文本格式',
    ai: 'AI 处理',
    'ai-write': 'AI 写作',
    'ai-custom': '自定义 AI',
    'mobile-more': '更多写作工具',
    'image-src': '编辑图片地址',
    'image-alt': '编辑图片说明',
    'table-align': '表格对齐',
    'table-more': '更多表格操作',
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader>
          <DrawerTitle>{mode ? titleMap[mode] : '更多操作'}</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-6">
          {mode === 'insert' && (
            <>
              <ActionButton label="标题" description="插入或切换为二级标题" onClick={() => onAction('insert-heading-2')} />
              <ActionButton label="无序列表" onClick={() => onAction('insert-bullet-list')} />
              <ActionButton label="有序列表" onClick={() => onAction('insert-ordered-list')} />
              <ActionButton label="待办列表" onClick={() => onAction('insert-task-list')} />
              <ActionButton label="引用" onClick={() => onAction('insert-blockquote')} />
              <ActionButton label="代码块" onClick={() => onAction('insert-code-block')} />
              <ActionButton label="分割线" onClick={() => onAction('insert-horizontal-rule')} />
              <ActionButton label="图片" description="从本地选择图片插入当前光标位置" onClick={() => onAction('insert-image')} />
              <ActionButton label="表格" onClick={() => onAction('insert-table')} />
            </>
          )}

          {mode === 'format' && (
            <>
              <ActionButton label="正文" onClick={() => onAction('format-paragraph')} />
              <ActionButton label="一级标题" onClick={() => onAction('format-heading-1')} />
              <ActionButton label="二级标题" onClick={() => onAction('format-heading-2')} />
              <ActionButton label="三级标题" onClick={() => onAction('format-heading-3')} />
              <ActionButton label="粗体" onClick={() => onAction('format-bold')} />
              <ActionButton label="斜体" onClick={() => onAction('format-italic')} />
              <ActionButton label="高亮" onClick={() => onAction('format-highlight')} />
            </>
          )}

          {mode === 'ai' && (
            <>
              <ActionButton label="润色选中文本" onClick={() => onAction('ai-polish')} />
              <ActionButton label="精简选中文本" onClick={() => onAction('ai-concise')} />
              <ActionButton label="扩写选中文本" onClick={() => onAction('ai-expand')} />
            </>
          )}

          {mode === 'ai-write' && (
            <>
              <ActionButton label="继续写" description="根据光标前后内容续写" onClick={() => onAction('ai-continue')} />
              <ActionButton label="生成章节" description="在当前位置补充一个完整段落" onClick={() => onAction('ai-generate-section')} />
              <ActionButton label="总结全文" description="基于当前笔记生成摘要" onClick={() => onAction('ai-generate-summary')} />
              <Textarea
                value={customAiInstruction}
                onChange={(event) => onCustomAiInstructionChange(event.target.value)}
                placeholder="输入自定义 AI 指令，例如：整理成会议纪要"
                rows={3}
                maxRows={8}
              />
              <Button onClick={onSubmitCustomAiInstruction}>执行自定义指令</Button>
            </>
          )}

          {mode === 'ai-custom' && (
            <>
              <Textarea
                value={customAiInstruction}
                onChange={(event) => onCustomAiInstructionChange(event.target.value)}
                placeholder="输入自定义 AI 指令，例如：整理成会议纪要"
                rows={3}
                maxRows={8}
              />
              <Button onClick={onSubmitCustomAiInstruction}>执行自定义指令</Button>
            </>
          )}

          {mode === 'mobile-more' && (
            <>
              <ActionButton label="文本格式" onClick={() => onAction('open-format-sheet')} />
              <ActionButton label="搜索替换" onClick={() => onAction('open-search-replace')} />
              <ActionButton label="大纲" onClick={() => onAction('toggle-outline')} />
              <ActionButton label="行内公式" onClick={() => onAction('insert-inline-math')} />
              <ActionButton label="块级公式" onClick={() => onAction('insert-block-math')} />
              <ActionButton label="Mermaid 图表" onClick={() => onAction('insert-mermaid')} />
              {pluginCommands.map((command) => (
                <ActionButton
                  key={command.id}
                  label={command.title}
                  description={command.description}
                  icon={command.icon}
                  disabled={command.disabled}
                  onClick={() => runPluginCommand(command)}
                />
              ))}
            </>
          )}

          {mode === 'image-src' && (
            <>
              <Input value={imageSrc} onChange={(event) => onImageSrcChange(event.target.value)} placeholder="输入图片地址" />
              <Button onClick={onSubmitImageSrc}>保存地址</Button>
            </>
          )}

          {mode === 'image-alt' && (
            <>
              <Input value={imageAlt} onChange={(event) => onImageAltChange(event.target.value)} placeholder="输入图片说明" />
              <Button onClick={onSubmitImageAlt}>保存说明</Button>
            </>
          )}

          {mode === 'table-align' && (
            <>
              <ActionButton label="左对齐" onClick={() => onAction('align-left')} />
              <ActionButton label="居中对齐" onClick={() => onAction('align-center')} />
              <ActionButton label="右对齐" onClick={() => onAction('align-right')} />
            </>
          )}

          {mode === 'table-more' && (
            <>
              <ActionButton label="在上方插入行" onClick={() => onAction('add-row-before')} />
              <ActionButton label="在下方插入行" onClick={() => onAction('add-row-after')} />
              <ActionButton label="在左侧插入列" onClick={() => onAction('add-column-before')} />
              <ActionButton label="在右侧插入列" onClick={() => onAction('add-column-after')} />
              <ActionButton label="删除当前行" onClick={() => onAction('delete-row')} destructive />
              <ActionButton label="删除当前列" onClick={() => onAction('delete-column')} destructive />
              <ActionButton label="删除整个表格" onClick={() => onAction('delete-table')} destructive />
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default MobileEditorMoreSheet
