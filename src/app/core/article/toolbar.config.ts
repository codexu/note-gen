import { isMobileDevice } from '@/lib/check'

export const createToolbarConfig = () => {
  // 定义所有工具栏项目，不分组
  const allTools = [
    { name: 'undo', tipPosition: 's' },
    { name: 'redo', tipPosition: 's' },
    { name: 'headings', tipPosition: 's', className: 'bottom' },
    { name: 'bold', tipPosition: 's' },
    { name: 'italic', tipPosition: 's' },
    { name: 'strike', tipPosition: 's' },
    { name: 'line', tipPosition: 's' },
    { name: 'quote', tipPosition: 's' },
    { name: 'list', tipPosition: 's' },
    { name: 'ordered-list', tipPosition: 's' },
    { name: 'check', tipPosition: 's' },
    { name: 'code', tipPosition: 's' },
    { name: 'inline-code', tipPosition: 's' },
    { name: 'upload', tipPosition: 's' },
    { name: 'link', tipPosition: 's' },
    { name: 'table', tipPosition: 's' },
    { name: 'edit-mode', tipPosition: 's', className: 'bottom edit-mode-button' },
    // 注意：editor-search 是动态添加的自定义按钮，不在这里定义
    // 实际的按钮会在 MdEditor 组件中动态添加到工具栏
    { name: 'preview', tipPosition: 's' },
  ]

  if (isMobileDevice()) {
    // 移动端：显示所有编辑工具，但不显示 edit-mode、preview
    return allTools.filter(tool =>
      !['edit-mode', 'preview'].includes(tool.name)
    )
  }

  // 桌面端：直接返回所有工具
  return allTools
}