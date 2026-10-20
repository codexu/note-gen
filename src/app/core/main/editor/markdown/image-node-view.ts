'use client'

import type {
  Editor,
  NodeViewRenderer,
  NodeViewRendererProps,
  ResizableNodeViewDirection,
} from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'
import { observeElementNearViewport } from './viewport-activation'

const DEFAULT_MIN_SIZE = 48
const DEFAULT_PLACEHOLDER_WIDTH = 320
const DEFAULT_PLACEHOLDER_HEIGHT = 180

const IMAGE_RESIZE_DIRECTIONS: readonly ResizableNodeViewDirection[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

type ImageSourceState = 'deferred' | 'loading' | 'active' | 'error'

interface ImageDimensions {
  height: number
  width: number
}

interface ResizeSnapshot extends ImageDimensions {
  heightAttribute: string | null
  heightStyle: string
  widthAttribute: string | null
  widthStyle: string
}

export interface ImageResizeCommitContext extends ImageDimensions {
  editor: Editor
  getPos: NodeViewRendererProps['getPos']
  image: HTMLImageElement
  node: ProseMirrorNode
}

export type ImageSourceResolver = (
  relativeSource: string,
  image: HTMLImageElement
) => Promise<string> | string

export type ImageSourceActivator = (
  image: HTMLImageElement
) => Promise<unknown> | unknown

export type ImageViewportObserver = (
  image: HTMLImageElement,
  callback: () => void
) => () => void

export interface ImageNodeViewOptions {
  activateImageSource?: ImageSourceActivator
  alwaysPreserveAspectRatio?: boolean
  getSourceContextKey?: () => string
  minHeight?: number
  minWidth?: number
  observeNearViewport?: ImageViewportObserver
  onCommit?: (context: ImageResizeCommitContext) => void
  placeholderHeight?: number
  placeholderWidth?: number
  subscribeSourceContextChange?: (callback: () => void) => () => void
}

const imageActivationTokens = new WeakMap<HTMLImageElement, symbol>()

function getStringAttribute(
  attributes: Readonly<Record<string, unknown>>,
  name: string
): string {
  return typeof attributes[name] === 'string' ? attributes[name] : ''
}

function parseImageDimension(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(trimmed)) {
    return null
  }

  const parsed = Number.parseFloat(trimmed.replace(/px$/i, ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function setImageSourceState(image: HTMLImageElement, state: ImageSourceState): void {
  image.dataset.imageSourceState = state

  if (state === 'deferred' || state === 'loading') {
    image.setAttribute('aria-busy', 'true')
  } else {
    image.removeAttribute('aria-busy')
  }
}

function invalidateImageSourceActivation(image: HTMLImageElement): void {
  imageActivationTokens.delete(image)
  image.removeAttribute('data-image-activated-relative-src')
}

/**
 * Resolve and attach the source of a deferred workspace image.
 *
 * The resolver stays outside the NodeView so it can use the active workspace,
 * record-tab, and Tauri asset APIs without coupling those concerns to the DOM.
 */
export async function activateImageSource(
  image: HTMLImageElement,
  resolveSource: ImageSourceResolver
): Promise<boolean> {
  const relativeSource = image.getAttribute('data-relative-src') || ''
  if (!relativeSource || !shouldTransformImageSrcToWorkspaceAsset(relativeSource)) {
    return false
  }

  const currentSource = image.getAttribute('src')
  if (currentSource && !shouldTransformImageSrcToWorkspaceAsset(currentSource)) {
    image.dataset.imageActivatedRelativeSrc = relativeSource
    return true
  }

  if (imageActivationTokens.has(image)) {
    return false
  }

  const activationToken = Symbol(relativeSource)
  imageActivationTokens.set(image, activationToken)
  setImageSourceState(image, 'loading')

  try {
    const resolvedSource = await resolveSource(relativeSource, image)
    const isCurrentActivation = imageActivationTokens.get(image) === activationToken
    const hasSameRelativeSource = image.getAttribute('data-relative-src') === relativeSource

    if (!isCurrentActivation || !hasSameRelativeSource || !resolvedSource) {
      return false
    }

    image.dataset.imageActivatedRelativeSrc = relativeSource
    image.dataset.imageExpectedSrc = resolvedSource
    image.loading = 'lazy'
    image.decoding = 'async'
    image.setAttribute('src', resolvedSource)
    return true
  } catch {
    if (
      imageActivationTokens.get(image) === activationToken &&
      image.getAttribute('data-relative-src') === relativeSource
    ) {
      setImageSourceState(image, 'error')
    }

    return false
  } finally {
    if (imageActivationTokens.get(image) === activationToken) {
      imageActivationTokens.delete(image)
    }
  }
}

export function commitImageNodeDimensions({
  editor,
  getPos,
  height,
  node,
  width,
}: ImageResizeCommitContext): void {
  if (editor.isDestroyed) {
    return
  }

  let position: number | undefined
  try {
    position = getPos()
  } catch {
    return
  }

  if (typeof position !== 'number') {
    return
  }

  editor
    .chain()
    .setNodeSelection(position)
    .updateAttributes(node.type.name, { width, height })
    .run()
}

function getPlaceholderDimensions(
  attributes: Readonly<Record<string, unknown>>,
  minWidth: number,
  minHeight: number,
  placeholderWidth: number,
  placeholderHeight: number
): ImageDimensions {
  const attributeWidth = parseImageDimension(attributes.width)
  const attributeHeight = parseImageDimension(attributes.height)
  const fallbackRatio = placeholderWidth / placeholderHeight

  let width = attributeWidth ?? placeholderWidth
  let height = attributeHeight ?? placeholderHeight

  if (attributeWidth && !attributeHeight) {
    height = attributeWidth / fallbackRatio
  } else if (!attributeWidth && attributeHeight) {
    width = attributeHeight * fallbackRatio
  }

  width = Math.max(minWidth, width)
  height = Math.max(minHeight, height)

  return {
    height: Math.round(height),
    width: Math.round(width),
  }
}

function positionResizeHandle(
  handle: HTMLElement,
  direction: ResizableNodeViewDirection
): void {
  const isTop = direction.includes('top')
  const isBottom = direction.includes('bottom')
  const isLeft = direction.includes('left')
  const isRight = direction.includes('right')

  if (isTop) handle.style.top = '0'
  if (isBottom) handle.style.bottom = '0'
  if (isLeft) handle.style.left = '0'
  if (isRight) handle.style.right = '0'

  if (direction === 'top' || direction === 'bottom') {
    handle.style.left = '0'
    handle.style.right = '0'
  }

  if (direction === 'left' || direction === 'right') {
    handle.style.top = '0'
    handle.style.bottom = '0'
  }
}

function calculateResizeDimensions(
  direction: ResizableNodeViewDirection,
  deltaX: number,
  deltaY: number,
  startDimensions: ImageDimensions,
  aspectRatio: number,
  preserveAspectRatio: boolean,
  minWidth: number,
  minHeight: number
): ImageDimensions {
  const isRight = direction.includes('right')
  const isLeft = direction.includes('left')
  const isBottom = direction.includes('bottom')
  const isTop = direction.includes('top')
  let width = startDimensions.width
  let height = startDimensions.height

  if (isRight) width += deltaX
  if (isLeft) width -= deltaX
  if (isBottom) height += deltaY
  if (isTop) height -= deltaY

  if (preserveAspectRatio) {
    const isVerticalOnly = direction === 'top' || direction === 'bottom'
    if (isVerticalOnly) {
      height = Math.max(minHeight, minWidth / aspectRatio, height)
      width = height * aspectRatio
    } else {
      width = Math.max(minWidth, minHeight * aspectRatio, width)
      height = width / aspectRatio
    }
  } else {
    width = Math.max(minWidth, width)
    height = Math.max(minHeight, height)
  }

  return {
    height: Math.round(height),
    width: Math.round(width),
  }
}

export function createImageNodeView(options: ImageNodeViewOptions = {}): NodeViewRenderer {
  const minWidth = normalizePositiveNumber(options.minWidth, DEFAULT_MIN_SIZE)
  const minHeight = normalizePositiveNumber(options.minHeight, DEFAULT_MIN_SIZE)
  const placeholderWidth = normalizePositiveNumber(
    options.placeholderWidth,
    DEFAULT_PLACEHOLDER_WIDTH
  )
  const placeholderHeight = normalizePositiveNumber(
    options.placeholderHeight,
    DEFAULT_PLACEHOLDER_HEIGHT
  )
  const observeNearViewport = options.observeNearViewport ?? observeElementNearViewport
  const onCommit = options.onCommit ?? commitImageNodeDimensions

  return ({ editor, getPos, node }) => {
    let currentNode = node
    let destroyed = false
    let isSelected = false
    let isResizing = false
    let activeDirection: ResizableNodeViewDirection | null = null
    let activeHandle: HTMLElement | null = null
    let activePointerId: number | null = null
    let resizeDocument: Document | null = null
    let resizeSnapshot: ResizeSnapshot | null = null
    let resizeStart: ImageDimensions = { width: minWidth, height: minHeight }
    let resizeCurrent: ImageDimensions = resizeStart
    let resizeAspectRatio = 1
    let sourceObserverCleanup: (() => void) | null = null
    let sourceContextCleanup: (() => void) | null = null
    let sourceActivationGeneration = 0
    let currentSourceIdentity = ''

    const container = document.createElement('span')
    container.className = 'image-resize-container'
    container.dataset.resizeContainer = ''
    container.dataset.node = node.type.name

    const wrapper = document.createElement('span')
    wrapper.className = 'image-resize-wrapper'
    wrapper.dataset.resizeWrapper = ''
    wrapper.style.display = 'block'
    wrapper.style.position = 'relative'

    const image = document.createElement('img')
    image.className = 'max-w-full rounded-lg'
    image.loading = 'lazy'
    image.decoding = 'async'

    wrapper.appendChild(image)
    container.appendChild(wrapper)

    const handleListeners = new Map<HTMLElement, (event: PointerEvent) => void>()

    const clearSourceObserver = (): void => {
      sourceObserverCleanup?.()
      sourceObserverCleanup = null
    }

    const applyImageDimensions = (): void => {
      if (isResizing) {
        return
      }

      const attributes = currentNode.attrs as Readonly<Record<string, unknown>>
      const attributeWidth = parseImageDimension(attributes.width)
      const attributeHeight = parseImageDimension(attributes.height)
      const sourceState = image.dataset.imageSourceState as ImageSourceState | undefined

      if (sourceState === 'active') {
        image.removeAttribute('data-image-placeholder')
        image.style.removeProperty('aspect-ratio')
        image.style.removeProperty('background-color')
        image.style.removeProperty('color')

        if (attributeWidth) {
          image.setAttribute('width', String(attributeWidth))
          image.style.width = `${attributeWidth}px`
        } else {
          image.removeAttribute('width')
          image.style.removeProperty('width')
        }

        if (attributeHeight) {
          image.setAttribute('height', String(attributeHeight))
          image.style.height = `${attributeHeight}px`
        } else {
          image.removeAttribute('height')
          image.style.removeProperty('height')
        }

        return
      }

      const placeholder = getPlaceholderDimensions(
        attributes,
        minWidth,
        minHeight,
        placeholderWidth,
        placeholderHeight
      )

      image.dataset.imagePlaceholder = ''
      image.setAttribute('width', String(placeholder.width))
      image.setAttribute('height', String(placeholder.height))
      image.style.aspectRatio = `${placeholder.width} / ${placeholder.height}`
      image.style.backgroundColor = 'hsl(var(--muted) / 0.35)'
      image.style.color = 'transparent'

      if (attributeWidth) {
        image.style.width = `${attributeWidth}px`
      } else {
        image.style.removeProperty('width')
      }

      if (attributeHeight) {
        image.style.height = `${attributeHeight}px`
      } else {
        image.style.removeProperty('height')
      }
    }

    const handleImageLoad = (): void => {
      const currentSource = image.getAttribute('src')
      if (!currentSource) {
        return
      }

      image.dataset.imageExpectedSrc = currentSource

      const relativeSource = image.getAttribute('data-relative-src') || ''
      if (
        relativeSource &&
        shouldTransformImageSrcToWorkspaceAsset(relativeSource) &&
        !shouldTransformImageSrcToWorkspaceAsset(currentSource)
      ) {
        image.dataset.imageActivatedRelativeSrc = relativeSource
      }

      setImageSourceState(image, 'active')
      applyImageDimensions()
    }

    const handleImageError = (): void => {
      const currentSource = image.getAttribute('src')
      if (!currentSource) {
        return
      }


      image.dataset.imageExpectedSrc = currentSource

      setImageSourceState(image, 'error')
      applyImageDimensions()
    }

    image.addEventListener('load', handleImageLoad)
    image.addEventListener('error', handleImageError)

    const refreshSourceObserver = (): void => {
      clearSourceObserver()

      const relativeSource = image.getAttribute('data-relative-src') || ''
      if (
        destroyed ||
        !options.activateImageSource ||
        image.dataset.imageSourceState !== 'deferred' ||
        !shouldTransformImageSrcToWorkspaceAsset(relativeSource)
      ) {
        return
      }

      const activationGeneration = ++sourceActivationGeneration
      if (!image.isConnected) {
        const frameId = window.requestAnimationFrame(() => {
          sourceObserverCleanup = null
          if (
            destroyed
            || activationGeneration !== sourceActivationGeneration
            || image.getAttribute('data-relative-src') !== relativeSource
          ) {
            return
          }

          refreshSourceObserver()
        })
        sourceObserverCleanup = () => window.cancelAnimationFrame(frameId)
        return
      }

      let activatedSynchronously = false
      const cleanup = observeNearViewport(image, () => {
        activatedSynchronously = true
        sourceObserverCleanup = null

        if (
          destroyed ||
          activationGeneration !== sourceActivationGeneration ||
          image.getAttribute('data-relative-src') !== relativeSource
        ) {
          return
        }

        setImageSourceState(image, 'loading')
        Promise.resolve(options.activateImageSource?.(image))
          .then(() => {
            if (
              destroyed ||
              activationGeneration !== sourceActivationGeneration ||
              image.getAttribute('data-relative-src') !== relativeSource
            ) {
              return
            }

            if (!image.getAttribute('src')) {
              setImageSourceState(image, 'error')
              applyImageDimensions()
            }
          })
          .catch(() => {
            if (
              !destroyed &&
              activationGeneration === sourceActivationGeneration &&
              image.getAttribute('data-relative-src') === relativeSource
            ) {
              setImageSourceState(image, 'error')
              applyImageDimensions()
            }
          })
      })

      if (!activatedSynchronously) {
        sourceObserverCleanup = cleanup
      } else {
        cleanup()
      }
    }

    const syncImageSource = (): void => {
      const attributes = currentNode.attrs as Readonly<Record<string, unknown>>
      const sourceAttribute = getStringAttribute(attributes, 'src')
      const relativeSourceAttribute = getStringAttribute(attributes, 'relativeSrc')
      const source = sourceAttribute || relativeSourceAttribute
      const isDeferredSource = shouldTransformImageSrcToWorkspaceAsset(source)
      const relativeSource = relativeSourceAttribute || (isDeferredSource ? source : '')
      const sourceContextKey = options.getSourceContextKey?.() || ''
      const sourceIdentity = JSON.stringify([
        sourceContextKey,
        sourceAttribute,
        relativeSourceAttribute,
      ])
      const previousSourceIdentity = currentSourceIdentity
      const sourceChanged = previousSourceIdentity !== sourceIdentity
      const currentSource = image.getAttribute('src')

      currentSourceIdentity = sourceIdentity
      if (relativeSource) {
        image.dataset.relativeSrc = relativeSource
      } else {
        image.removeAttribute('data-relative-src')
      }

      if (sourceChanged) {
        sourceActivationGeneration += 1
        clearSourceObserver()
        invalidateImageSourceActivation(image)
        image.removeAttribute('data-image-expected-src')
      }

      if (!source) {
        image.removeAttribute('src')
        setImageSourceState(image, 'deferred')
        return
      }

      if (isDeferredSource) {
        const preservedConvertedSource =
          !sourceChanged &&
          Boolean(currentSource) &&
          (
            image.dataset.imageActivatedRelativeSrc === relativeSource ||
            !shouldTransformImageSrcToWorkspaceAsset(currentSource)
          )

        if (!preservedConvertedSource && currentSource) {
          image.removeAttribute('src')
          image.removeAttribute('data-image-expected-src')
        }

        if (preservedConvertedSource && currentSource) {
          image.dataset.imageExpectedSrc = currentSource
          setImageSourceState(
            image,
            image.complete && image.naturalWidth > 0 ? 'active' : 'loading'
          )
        } else if (
          sourceChanged ||
          image.dataset.imageSourceState === 'active' ||
          !image.dataset.imageSourceState
        ) {
          setImageSourceState(image, 'deferred')
        }

        refreshSourceObserver()
        return
      }

      sourceActivationGeneration += 1
      clearSourceObserver()
      invalidateImageSourceActivation(image)
      image.dataset.imageExpectedSrc = source

      if (currentSource !== source) {
        setImageSourceState(image, 'loading')
        image.setAttribute('src', source)
      } else if (image.complete && image.naturalWidth > 0) {
        setImageSourceState(image, 'active')
      } else if (image.dataset.imageSourceState !== 'error') {
        setImageSourceState(image, 'loading')
      }
    }

    const syncImageAttributes = (): void => {
      const attributes = currentNode.attrs as Readonly<Record<string, unknown>>
      const alt = getStringAttribute(attributes, 'alt')
      const title = getStringAttribute(attributes, 'title')

      image.alt = alt
      if (title) {
        image.title = title
      } else {
        image.removeAttribute('title')
      }

      syncImageSource()
      applyImageDimensions()

      if (image.complete && image.naturalWidth > 0 && image.getAttribute('src')) {
        handleImageLoad()
      }
    }

    const applyLiveDimensions = ({ width, height }: ImageDimensions): void => {
      image.setAttribute('width', String(width))
      image.setAttribute('height', String(height))
      image.style.width = `${width}px`
      image.style.height = `${height}px`
    }

    const clearResizeListeners = (): void => {
      if (resizeDocument) {
        resizeDocument.removeEventListener('pointermove', handlePointerMove)
        resizeDocument.removeEventListener('pointerup', handlePointerUp)
        resizeDocument.removeEventListener('pointercancel', handlePointerCancel)
        resizeDocument.removeEventListener('keydown', handleResizeKeyDown)
      }

      if (activeHandle && activePointerId !== null) {
        try {
          if (activeHandle.hasPointerCapture(activePointerId)) {
            activeHandle.releasePointerCapture(activePointerId)
          }
        } catch {
          // Pointer capture may already be gone when the node is removed.
        }
      }

      resizeDocument = null
      activeHandle = null
      activePointerId = null
    }

    const finishResize = (commit: boolean, restore: boolean): void => {
      if (!isResizing) {
        clearResizeListeners()
        return
      }

      const snapshot = resizeSnapshot
      isResizing = false
      activeDirection = null
      resizeSnapshot = null
      container.dataset.resizeState = 'false'
      container.classList.remove('image-resize-active')
      clearResizeListeners()

      if (restore && snapshot) {
        if (snapshot.widthAttribute) {
          image.setAttribute('width', snapshot.widthAttribute)
        } else {
          image.removeAttribute('width')
        }

        if (snapshot.heightAttribute) {
          image.setAttribute('height', snapshot.heightAttribute)
        } else {
          image.removeAttribute('height')
        }

        image.style.width = snapshot.widthStyle
        image.style.height = snapshot.heightStyle
        return
      }

      if (!commit || destroyed) {
        return
      }

      const committedDimensions = {
        height: Math.max(minHeight, Math.round(resizeCurrent.height)),
        width: Math.max(minWidth, Math.round(resizeCurrent.width)),
      }
      applyLiveDimensions(committedDimensions)
      onCommit({
        ...committedDimensions,
        editor,
        getPos,
        image,
        node: currentNode,
      })
    }

    function handlePointerMove(event: PointerEvent): void {
      if (
        !isResizing ||
        activeDirection === null ||
        activePointerId !== event.pointerId
      ) {
        return
      }

      event.preventDefault()
      resizeCurrent = calculateResizeDimensions(
        activeDirection,
        event.clientX - resizeStartX,
        event.clientY - resizeStartY,
        resizeStart,
        resizeAspectRatio,
        options.alwaysPreserveAspectRatio === true || event.shiftKey,
        minWidth,
        minHeight
      )
      applyLiveDimensions(resizeCurrent)
    }

    function handlePointerUp(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      finishResize(true, false)
    }

    function handlePointerCancel(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) {
        return
      }

      finishResize(false, true)
    }

    function handleResizeKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      finishResize(false, true)
    }

    let resizeStartX = 0
    let resizeStartY = 0

    const startResize = (
      event: PointerEvent,
      direction: ResizableNodeViewDirection,
      handle: HTMLElement
    ): void => {
      if (
        destroyed ||
        isResizing ||
        !editor.isEditable ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const bounds = image.getBoundingClientRect()
      const fallback = getPlaceholderDimensions(
        currentNode.attrs as Readonly<Record<string, unknown>>,
        minWidth,
        minHeight,
        placeholderWidth,
        placeholderHeight
      )
      const width = bounds.width > 0 ? bounds.width : fallback.width
      const height = bounds.height > 0 ? bounds.height : fallback.height

      resizeStartX = event.clientX
      resizeStartY = event.clientY
      resizeStart = { width, height }
      resizeCurrent = resizeStart
      resizeAspectRatio = width > 0 && height > 0 ? width / height : 1
      resizeSnapshot = {
        height,
        heightAttribute: image.getAttribute('height'),
        heightStyle: image.style.height,
        width,
        widthAttribute: image.getAttribute('width'),
        widthStyle: image.style.width,
      }
      isResizing = true
      activeDirection = direction
      activeHandle = handle
      activePointerId = event.pointerId
      const ownerDocument = image.ownerDocument
      resizeDocument = ownerDocument
      container.dataset.resizeState = 'true'
      container.classList.add('image-resize-active')

      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Document listeners still keep resizing functional without capture.
      }

      ownerDocument.addEventListener('pointermove', handlePointerMove)
      ownerDocument.addEventListener('pointerup', handlePointerUp)
      ownerDocument.addEventListener('pointercancel', handlePointerCancel)
      ownerDocument.addEventListener('keydown', handleResizeKeyDown)
    }

    const removeHandles = (): void => {
      for (const [handle, listener] of handleListeners) {
        handle.removeEventListener('pointerdown', listener)
        handle.remove()
      }
      handleListeners.clear()
    }

    const attachHandles = (): void => {
      if (handleListeners.size > 0 || destroyed || !editor.isEditable) {
        return
      }

      for (const direction of IMAGE_RESIZE_DIRECTIONS) {
        const handle = document.createElement('span')
        handle.className = 'image-resize-handle'
        handle.dataset.resizeHandle = direction
        handle.style.position = 'absolute'
        handle.style.touchAction = 'none'
        handle.contentEditable = 'false'
        handle.setAttribute('aria-hidden', 'true')
        positionResizeHandle(handle, direction)

        const listener = (event: PointerEvent) => startResize(event, direction, handle)
        handle.addEventListener('pointerdown', listener)
        handleListeners.set(handle, listener)
        wrapper.appendChild(handle)
      }
    }

    syncImageAttributes()
    sourceContextCleanup = options.subscribeSourceContextChange?.(() => {
      if (!destroyed) {
        syncImageAttributes()
      }
    }) ?? null

    const nodeView: NodeView = {
      dom: container,
      update(updatedNode) {
        if (updatedNode.type !== currentNode.type || destroyed) {
          return false
        }

        currentNode = updatedNode
        syncImageAttributes()

        if (isSelected && editor.isEditable) {
          attachHandles()
        } else if (!editor.isEditable) {
          if (isResizing) finishResize(false, true)
          removeHandles()
        }

        return true
      },
      selectNode() {
        isSelected = true
        container.classList.add('ProseMirror-selectednode')
        attachHandles()
      },
      deselectNode() {
        isSelected = false
        container.classList.remove('ProseMirror-selectednode')
        if (isResizing) finishResize(false, true)
        removeHandles()
      },
      stopEvent(event) {
        const target = event.target
        return target instanceof HTMLElement && target.hasAttribute('data-resize-handle')
      },
      ignoreMutation(mutation) {
        return mutation.type !== 'selection'
      },
      destroy() {
        if (destroyed) {
          return
        }

        destroyed = true
        sourceActivationGeneration += 1
        clearSourceObserver()
        sourceContextCleanup?.()
        sourceContextCleanup = null
        invalidateImageSourceActivation(image)
        finishResize(false, false)
        removeHandles()
        image.removeEventListener('load', handleImageLoad)
        image.removeEventListener('error', handleImageError)
        container.remove()
      },
    }

    return nodeView
  }
}
