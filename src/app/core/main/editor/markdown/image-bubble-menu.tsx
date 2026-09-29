'use client'

import { Editor } from '@tiptap/react'
import { Check, RotateCcw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PluginEditorToolbar } from '@/components/plugins/plugin-editor-toolbar'

interface ImageBubbleMenuProps {
  editor: Editor
  pluginsEnabled?: boolean
}

interface ImageInfo {
  pos: number
}

interface MenuPosition {
  top: number
  left: number
  width: number
}

function parseImageDimension(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(trimmed)) return null

  const parsed = Number.parseInt(trimmed.replace(/px$/i, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseDimensionInput(value: string): number | null {
  return value.trim() ? parseImageDimension(value) : null
}

export function ImageBubbleMenu({ editor, pluginsEnabled = false }: ImageBubbleMenuProps) {
  const t = useTranslations('editor.image')
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const [altText, setAltText] = useState('')
  const [srcText, setSrcText] = useState('')
  const [widthText, setWidthText] = useState('')
  const [heightText, setHeightText] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedImageRef = useRef<HTMLImageElement | null>(null)

  const updateMenuPosition = useCallback(() => {
    const image = selectedImageRef.current
    const positionContainer = editor.view.dom.parentElement
    const scrollContainer = editor.view.dom.closest<HTMLElement>('.editor-scroll-container')
    if (!image || !positionContainer || !scrollContainer || !image.isConnected) {
      setMenuPosition(null)
      return
    }

    const imageBounds = image.getBoundingClientRect()
    const positionBounds = positionContainer.getBoundingClientRect()
    const scrollBounds = scrollContainer.getBoundingClientRect()
    if (imageBounds.bottom < scrollBounds.top || imageBounds.top > scrollBounds.bottom) {
      setMenuPosition(null)
      return
    }

    const width = Math.min(420, scrollBounds.width - 24)
    if (width < 200) {
      setMenuPosition(null)
      return
    }

    const imageCenter = imageBounds.left - positionBounds.left
      + positionContainer.scrollLeft
      + imageBounds.width / 2
    const minimumLeft = scrollBounds.left - positionBounds.left + positionContainer.scrollLeft + 12
    const maximumLeft = scrollBounds.right - positionBounds.left + positionContainer.scrollLeft - width - 12
    const left = Math.max(minimumLeft, Math.min(imageCenter - width / 2, maximumLeft))
    const menuHeight = menuRef.current?.offsetHeight || 300
    const visibleTop = scrollBounds.top - positionBounds.top + positionContainer.scrollTop + 12
    const visibleBottom = scrollBounds.bottom - positionBounds.top + positionContainer.scrollTop - 12
    const visibleImageTop = Math.max(imageBounds.top, scrollBounds.top)
    const visibleImageBottom = Math.min(imageBounds.bottom, scrollBounds.bottom)
    const visibleImageCenter = (visibleImageTop + visibleImageBottom) / 2
      - positionBounds.top
      + positionContainer.scrollTop
    const top = Math.max(visibleTop, Math.min(visibleImageCenter - menuHeight / 2, visibleBottom - menuHeight))

    setMenuPosition({ top, left, width })
  }, [editor])

  const handleImageClick = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement
    const resizeContainer = target.closest<HTMLElement>('[data-resize-container][data-node="image"]')
    const image = target.closest<HTMLImageElement>('img')
      ?? resizeContainer?.querySelector<HTMLImageElement>('img')
    if (!image) return

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image') return

      const nodeRelativeSrc = node.attrs.relativeSrc || ''
      const nodeAssetSrc = node.attrs.src || ''
      const domSrc = image.src
      const domRelativeSrc = image.getAttribute('data-relative-src') || ''
      const matches =
        nodeRelativeSrc === domRelativeSrc
        || nodeRelativeSrc === domRelativeSrc.replace(/^\.\//, '')
        || nodeAssetSrc === domSrc
        || Boolean(nodeRelativeSrc && domSrc.includes(nodeRelativeSrc))
        || Boolean(nodeRelativeSrc && domRelativeSrc.includes(nodeRelativeSrc))

      if (!matches) return

      editor.chain().setNodeSelection(pos).run()
      selectedImageRef.current = image
      setImageInfo({
        pos,
      })
      setAltText(node.attrs.alt || '')
      setSrcText(node.attrs.relativeSrc || node.attrs.src?.replace(/^(tauri|asset|http):\/\/localhost\//, '') || '')
      const imageBounds = image.getBoundingClientRect()
      const width = parseImageDimension(node.attrs.width) ?? Math.round(imageBounds.width)
      const height = parseImageDimension(node.attrs.height) ?? Math.round(imageBounds.height)
      setWidthText(width > 0 ? String(width) : '')
      setHeightText(height > 0 ? String(height) : '')
      window.requestAnimationFrame(updateMenuPosition)
      return false
    })
  }, [editor, updateMenuPosition])

  const closeMenu = useCallback(() => {
    selectedImageRef.current = null
    setImageInfo(null)
    setMenuPosition(null)
  }, [])

  const saveImage = useCallback(() => {
    const source = srcText.trim()
    if (imageInfo && source) {
      const width = parseDimensionInput(widthText)
      const height = parseDimensionInput(heightText)
      editor.chain().setNodeSelection(imageInfo.pos).updateAttributes('image', {
        src: source,
        relativeSrc: source,
        alt: altText,
        width,
        height,
      }).run()
    }
    closeMenu()
  }, [altText, closeMenu, editor, heightText, imageInfo, srcText, widthText])

  const resetSize = useCallback(() => {
    if (imageInfo) {
      editor.chain().setNodeSelection(imageInfo.pos).updateAttributes('image', {
        width: null,
        height: null,
      }).run()
      setWidthText('')
      setHeightText('')
    }
    window.requestAnimationFrame(updateMenuPosition)
  }, [editor, imageInfo, updateMenuPosition])

  const deleteImage = useCallback(() => {
    if (imageInfo) {
      editor.chain().focus().deleteRange({ from: imageInfo.pos, to: imageInfo.pos + 1 }).run()
    }
    closeMenu()
  }, [closeMenu, editor, imageInfo])

  useEffect(() => {
    const editorElement = editor.view.dom
    const scrollContainer = editorElement.closest<HTMLElement>('.editor-scroll-container')

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (menuRef.current?.contains(target)) return
      if (target.closest('img') === selectedImageRef.current) return
      if (target.closest('[data-resize-container][data-node="image"]')?.contains(selectedImageRef.current)) return
      closeMenu()
    }

    editorElement.addEventListener('click', handleImageClick)
    document.addEventListener('mousedown', handleClickOutside)
    scrollContainer?.addEventListener('scroll', updateMenuPosition, { passive: true })
    window.addEventListener('resize', updateMenuPosition)

    return () => {
      editorElement.removeEventListener('click', handleImageClick)
      document.removeEventListener('mousedown', handleClickOutside)
      scrollContainer?.removeEventListener('scroll', updateMenuPosition)
      window.removeEventListener('resize', updateMenuPosition)
    }
  }, [closeMenu, editor, handleImageClick, updateMenuPosition])

  useEffect(() => {
    if (imageInfo) window.requestAnimationFrame(updateMenuPosition)
  }, [imageInfo, updateMenuPosition])

  if (!imageInfo || !menuPosition) return null

  const handleFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveImage()
    } else if (event.key === 'Escape') {
      closeMenu()
    }
  }

  return (
    <div
      ref={menuRef}
      className="absolute z-40 rounded-xl bg-popover/95 p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop-blur"
      style={menuPosition}
      data-editor-image-menu
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{t('settings')}</div>
        {pluginsEnabled && imageInfo ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'image', nodePosition: imageInfo.pos }} /> : null}
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('cancel')} onClick={closeMenu}>
          <X />
        </Button>
      </div>

      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="image-source">{t('source')}</FieldLabel>
          <Input
            id="image-source"
            value={srcText}
            placeholder={t('srcPlaceholder')}
            onChange={event => setSrcText(event.target.value)}
            onKeyDown={handleFieldKeyDown}
            onFocus={event => event.target.select()}
            autoFocus
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="image-alt">{t('alt')}</FieldLabel>
          <Input
            id="image-alt"
            value={altText}
            placeholder={t('altPlaceholder')}
            onChange={event => setAltText(event.target.value)}
            onKeyDown={handleFieldKeyDown}
            onFocus={event => event.target.select()}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="image-width">{t('widthPlaceholder')}</FieldLabel>
            <Input
              id="image-width"
              type="number"
              min={1}
              step={1}
              value={widthText}
              onChange={event => setWidthText(event.target.value)}
              onKeyDown={handleFieldKeyDown}
              onFocus={event => event.target.select()}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="image-height">{t('heightPlaceholder')}</FieldLabel>
            <Input
              id="image-height"
              type="number"
              min={1}
              step={1}
              value={heightText}
              onChange={event => setHeightText(event.target.value)}
              onKeyDown={handleFieldKeyDown}
              onFocus={event => event.target.select()}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={resetSize}>
              <RotateCcw data-icon="inline-start" />
              {t('resetSize')}
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={deleteImage}>
              <Trash2 data-icon="inline-start" />
              {t('deleteShort')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeMenu}>
              <X data-icon="inline-start" />
              {t('cancel')}
            </Button>
            <Button type="button" size="sm" disabled={!srcText.trim()} onClick={saveImage}>
              <Check data-icon="inline-start" />
              {t('confirm')}
            </Button>
          </div>
        </div>
      </FieldGroup>
    </div>
  )
}
