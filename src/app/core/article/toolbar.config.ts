import { isMobileDevice } from '@/lib/check'
import emitter from '@/lib/emitter'

export const createToolbarConfig = (t: any, editorWidth?: number) => {
  // 定义工具栏分组
  const group1 = [
    { name: 'undo', tipPosition: 's' },
    { name: 'redo', tipPosition: 's' },
  ]

  const markTool = {
    name: 'mark',
    tipPosition: 's',
    tip: t('toolbar.mark.tooltip'),
    className: 'right',
    icon: '<svg><use xlink:href="#vditor-icon-mark"></svg>',
    click: () => emitter.emit('toolbar-mark'),
  }

  const group2Mobile = [
    markTool,
    {
      name: 'continue',
      tipPosition: 's',
      tip: t('toolbar.continue.tooltip'),
      className: 'right',
      icon: '<svg><use xlink:href="#vditor-icon-list-plus"></svg>',
      click: () => emitter.emit('toolbar-continue'),
    },
    {
      name: 'translation',
      tipPosition: 's',
      tip: t('toolbar.translation.tooltip'),
      className: 'right',
      icon: '<svg><use xlink:href="#vditor-icon-translation"></svg>',
      click: () => emitter.emit('toolbar-translation'),
    },
  ]

  const group2PC = [
    {
      name: 'continue',
      tipPosition: 's',
      tip: t('toolbar.continue.tooltip'),
      className: 'right',
      icon: '<svg><use xlink:href="#vditor-icon-list-plus"></svg>',
      click: () => emitter.emit('toolbar-continue'),
    },
    {
      name: 'translation',
      tipPosition: 's',
      tip: t('toolbar.translation.tooltip'),
      className: 'right',
      icon: '<svg><use xlink:href="#vditor-icon-translation"></svg>',
      click: () => emitter.emit('toolbar-translation'),
    },
  ]

  const group3 = [
    { name: 'headings', tipPosition: 's', className: 'bottom' },
    { name: 'bold', tipPosition: 's' },
    { name: 'italic', tipPosition: 's' },
    { name: 'strike', tipPosition: 's' },
  ]

  const group4 = [
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
  ]

  const groupLast = [
    { name: 'edit-mode', tipPosition: 's', className: 'bottom edit-mode-button' },
    { name: 'preview', tipPosition: 's' },
    { name: 'outline', tipPosition: 's' },
  ]

  // 根据编辑器宽度决定显示哪些组
  // 按钮宽度: 36px, 分割线宽度: 19px
  const BUTTON_WIDTH = 36
  const DIVIDER_WIDTH = 19
  
  // 计算每组的宽度
  const group1Width = group1.length * BUTTON_WIDTH // 2 * 36 = 72
  const group2PCWidth = group2PC.length * BUTTON_WIDTH // 2 * 36 = 72
  const group3Width = group3.length * BUTTON_WIDTH // 4 * 36 = 144
  const group4Width = group4.length * BUTTON_WIDTH // 10 * 36 = 360
  const groupLastWidth = groupLast.length * BUTTON_WIDTH // 3 * 36 = 108
  
  // 计算累计宽度阈值（包含分割线）
  const baseWidth = group1Width + DIVIDER_WIDTH + group2PCWidth // 72 + 19 + 72 = 163
  const withLastWidth = baseWidth + DIVIDER_WIDTH + groupLastWidth // 163 + 19 + 108 = 290
  const withGroup3Width = baseWidth + DIVIDER_WIDTH + group3Width + DIVIDER_WIDTH + groupLastWidth // 163 + 19 + 144 + 19 + 108 = 453
  const withGroup4Width = baseWidth + DIVIDER_WIDTH + group3Width + DIVIDER_WIDTH + group4Width + DIVIDER_WIDTH + groupLastWidth // 163 + 19 + 144 + 19 + 360 + 19 + 108 = 832
  
  let config: any[] = []
  
  if (isMobileDevice()) {
    config = [...group1, '|', ...group2Mobile, '|', ...groupLast]
  } else if (editorWidth) {
    // 基础组：始终显示 group1 + group2PC
    config = [...group1, '|', ...group2PC]
    
    // 根据宽度逐步添加更多组
    if (editorWidth >= withLastWidth) {
      config.push('|', ...groupLast)
    }
    
    if (editorWidth >= withGroup3Width) {
      // 在最后一组之前插入 group3
      const lastGroupIndex = config.length - groupLast.length - 1
      config.splice(lastGroupIndex, 0, '|', ...group3)
    }
    
    if (editorWidth >= withGroup4Width) {
      // 在最后一组之前插入 group4
      const lastGroupIndex = config.length - groupLast.length - 1
      config.splice(lastGroupIndex, 0, '|', ...group4)
    }
    
    // 如果宽度不足以显示最后一组，也要保证它显示
    if (editorWidth < withLastWidth) {
      config.push('|', ...groupLast)
    }
  } else {
    // 默认显示所有
    config = [
      ...group1,
      '|',
      ...group2PC,
      '|',
      ...group3,
      '|',
      ...group4,
      '|',
      ...groupLast,
    ]
  }

  return config
}