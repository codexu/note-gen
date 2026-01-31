'use client'

import { SimpleMobileTool } from '@/components/simple-mobile-tool'
import emitter from '@/lib/emitter'

interface MobileRecordToolsProps {
  onClose?: () => void
}

export function MobileRecordTools({ onClose }: MobileRecordToolsProps) {
  // 移动端固定的记录工具（排除截图）
  const mobileTools = [
    { id: 'text' },
    { id: 'recording' },
    { id: 'image' },
    { id: 'link' },
    { id: 'file' }
  ]

  const handleToolClick = (toolId: string) => {
    // 发射工具快捷键事件
    emitter.emit(`toolbar-shortcut-${toolId}` as any)
    // 点击后关闭弹窗
    if (onClose) {
      onClose()
    }
  }

  // 暂时忽略 onClose 参数的 lint 警告，未来可能用于在操作成功后关闭抽屉
  void onClose

  return (
    <div className="flex justify-around w-full">
      {mobileTools.map((tool) => (
        <SimpleMobileTool 
          key={tool.id}
          toolId={tool.id}
          onToolClick={handleToolClick}
        />
      ))}
    </div>
  )
}
