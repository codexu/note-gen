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
    { name: 'preview', tipPosition: 's' },
    { name: 'outline', tipPosition: 's' },
  ]

  if (isMobileDevice()) {
    // 移动端：显示所有编辑工具，但不显示 edit-mode、preview、outline
    return allTools.filter(tool => 
      !['edit-mode', 'preview', 'outline'].includes(tool.name)
    )
  }

  // 桌面端：直接返回所有工具
  return allTools
}