'use client'

import { Editor } from '@tiptap/react'
import { Trash2, Link, Type } from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface ImageBubbleMenuProps {
  editor: Editor
}

interface ImageInfo {
  src: string
  alt: string
  pos: number
  rect: DOMRect
}

type EditMode = 'none' | 'alt' | 'src'

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const t = useTranslations('editor.image')
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null)
  const [editMode, setEditMode] = useState<EditMode>('none')
  const [altText, setAltText] = useState('')
  const [srcText, setSrcText] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const isClickingMenu = useRef(false)

  // 全选 input 文本
  const selectAllText = (event: React.FocusEvent<HTMLInputElement>) => {
    event.target.select()
  }

  // 处理图片点击
  const handleImageClick = useCallback((event: MouseEvent) => {
    if (isClickingMenu.current) return

    const target = event.target as HTMLElement
    if (target.tagName !== 'IMG') return

    const dom = event.target as HTMLImageElement
    const rect = dom.getBoundingClientRect()

    // 遍历文档找到对应的图片节点
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === dom.src) {
        // 先选中图片节点
        editor.chain().setNodeSelection(pos).run()
        setImageInfo({
          src: node.attrs.src,
          alt: node.attrs.alt || '',
          pos,
          rect,
        })
        setAltText(node.attrs.alt || '')
        setSrcText(node.attrs.src || '')
        setEditMode('none')
        return false
      }
    })
  }, [editor])

  // 保存 alt 文本
  const saveAltText = useCallback(() => {
    if (imageInfo) {
      // 先选中图片节点，然后更新属性
      editor.chain().setNodeSelection(imageInfo.pos).updateAttributes('image', { alt: altText }).run()
      // 更新 imageInfo 中的值
      setImageInfo(prev => prev ? { ...prev, alt: altText } : null)
    }
    setEditMode('none')
  }, [editor, imageInfo, altText])

  // 保存 src 地址
  const saveSrc = useCallback(() => {
    if (imageInfo && srcText.trim()) {
      // 先选中图片节点，然后更新属性
      editor.chain().setNodeSelection(imageInfo.pos).updateAttributes('image', { src: srcText.trim() }).run()
      // 更新 imageInfo 中的值
      setImageInfo(prev => prev ? { ...prev, src: srcText.trim() } : null)
    }
    setEditMode('none')
  }, [editor, imageInfo, srcText])

  // 删除图片
  const deleteImage = useCallback(() => {
    if (imageInfo) {
      editor.chain().focus().deleteRange({ from: imageInfo.pos, to: imageInfo.pos + 1 }).run()
    }
    setImageInfo(null)
    setEditMode('none')
  }, [editor, imageInfo])

  // 点击菜单按钮
  const handleMenuClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    isClickingMenu.current = true
    setTimeout(() => {
      isClickingMenu.current = false
    }, 100)
  }, [])

  // 点击菜单外部关闭
  const handleClickOutside = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement

    if (menuRef.current?.contains(target)) return
    if (target.tagName === 'IMG') return

    setImageInfo(null)
    setEditMode('none')
  }, [])

  // 注册事件监听
  useEffect(() => {
    const editorElement = document.querySelector('.ProseMirror')
    if (editorElement) {
      editorElement.addEventListener('click', handleImageClick as EventListener)
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      if (editorElement) {
        editorElement.removeEventListener('click', handleImageClick as EventListener)
      }
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [handleImageClick, handleClickOutside])

  if (!imageInfo) return null

  // 获取滚动容器，计算相对于容器的坐标
  const scrollContainer = document.querySelector('.ProseMirror')?.parentElement
  const containerBounds = scrollContainer?.getBoundingClientRect()

  // 将视口坐标转换为滚动容器内的相对坐标
  const relativeTop = containerBounds
    ? imageInfo.rect.top - containerBounds.top + (scrollContainer?.scrollTop || 0) - 8
    : imageInfo.rect.top - 8

  const relativeLeft = containerBounds
    ? imageInfo.rect.left - containerBounds.left + (scrollContainer?.scrollLeft || 0) + imageInfo.rect.width / 2
    : imageInfo.rect.left + imageInfo.rect.width / 2

  // 边界检测：left 在 [0, 容器宽度 - 菜单宽度] 范围内
  const currentMenuWidth = menuRef.current?.offsetWidth || 200
  const maxLeft = containerBounds
    ? Math.max(0, containerBounds.width - currentMenuWidth)
    : relativeLeft - currentMenuWidth / 2
  const left = containerBounds
    ? Math.min(relativeLeft - currentMenuWidth / 2, maxLeft)
    : relativeLeft - currentMenuWidth / 2

  return (
    <div
      ref={menuRef}
      className="absolute z-50"
      style={{
        top: relativeTop,
        left: left,
      }}
    >
      <div
        className="flex items-center gap-0.5 px-1 py-1 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border border-border rounded-lg shadow-lg"
        onClick={handleMenuClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        {editMode === 'none' && (
          <>
            {/* 修改地址 */}
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors"
              onClick={() => {
                // 从编辑器读取最新值
                const node = editor.state.doc.nodeAt(imageInfo.pos)
                setSrcText(node?.attrs.src || imageInfo.src)
                setEditMode('src')
              }}
              title={t('editSrc')}
            >
              <Link className="w-4 h-4" />
            </button>

            {/* 修改 alt */}
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors"
              onClick={() => {
                // 从编辑器读取最新值
                const node = editor.state.doc.nodeAt(imageInfo.pos)
                setAltText(node?.attrs.alt || imageInfo.alt)
                setEditMode('alt')
              }}
              title={t('editAlt')}
            >
              <Type className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-border mx-1" />

            {/* 删除 */}
            <button
              className="p-1.5 rounded hover:bg-muted transition-colors text-destructive"
              onClick={deleteImage}
              title={t('delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}

        {editMode === 'alt' && (
          <div className="flex items-center gap-1 px-1">
            <Type className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('altPlaceholder')}
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveAltText()
                } else if (e.key === 'Escape') {
                  setEditMode('none')
                }
              }}
              onFocus={selectAllText}
              className="w-40 px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              className="p-1 rounded hover:bg-muted text-xs"
              onClick={saveAltText}
            >
              {t('confirm')}
            </button>
            <button
              className="p-1 rounded hover:bg-muted text-xs"
              onClick={() => setEditMode('none')}
            >
              {t('cancel')}
            </button>
          </div>
        )}

        {editMode === 'src' && (
          <div className="flex items-center gap-1 px-1">
            <Link className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('srcPlaceholder')}
              value={srcText}
              onChange={(e) => setSrcText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveSrc()
                } else if (e.key === 'Escape') {
                  setEditMode('none')
                }
              }}
              onFocus={selectAllText}
              className="w-60 px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              className="p-1 rounded hover:bg-muted text-xs"
              onClick={saveSrc}
            >
              {t('confirm')}
            </button>
            <button
              className="p-1 rounded hover:bg-muted text-xs"
              onClick={() => setEditMode('none')}
            >
              {t('cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ImageBubbleMenu
