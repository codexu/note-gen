'use client'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { EmitterRecordEvents } from '@/config/emitters'
import { getTags, insertTag } from '@/db/tags'
import { insertExternalMark, updateMark, type Mark } from '@/db/marks'
import { useToast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'
import { captureLink } from '@/lib/link-capture'
import { recognizeImageWithFallback } from '@/lib/image-recognition'
import {
  cacheCapturedRecordImage,
  localizeCapturedImages,
  removeLinkAssetGroup,
} from '@/lib/web-capture/images'
import type {
  WebClipperBridgeRequest,
  WebClipperClip,
  WebClipperConnection,
  WebClipperPairingRequest,
} from '@/lib/web-clipper/types'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024

interface CreateClipPayload {
  connection: WebClipperConnection
  clip: WebClipperClip
}

interface BridgeError {
  code: string
  message: string
}

let tagCreationQueue: Promise<void> = Promise.resolve()

function createOrFindTag(name: string) {
  const task = tagCreationQueue.then(async () => {
    const tags = await getTags()
    const existing = tags.find(tag => tag.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
    if (existing) return { id: existing.id, name: existing.name, alreadyExists: true }
    const result = await insertTag({ name })
    await useTagStore.getState().fetchTags()
    return { id: result.lastInsertId as number, name, alreadyExists: false }
  })
  tagCreationQueue = task.then(() => undefined, () => undefined)
  return task
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readClipPayload(value: unknown): CreateClipPayload {
  if (!isRecord(value) || !isRecord(value.connection) || !isRecord(value.clip)) {
    throw { code: 'invalid-request', message: 'Invalid web clipper payload' } satisfies BridgeError
  }

  const connection = value.connection
  const clip = value.clip
  const mode = clip.mode
  if (mode !== 'article' && mode !== 'selection' && mode !== 'link') {
    throw { code: 'invalid-request', message: 'Unsupported clipping mode' } satisfies BridgeError
  }
  if (clip.protocolVersion !== 1) {
    throw { code: 'protocol-mismatch', message: 'Unsupported web clipper protocol version' } satisfies BridgeError
  }
  if (
    typeof connection.installId !== 'string'
    || typeof clip.clipId !== 'string'
    || typeof clip.tagId !== 'number'
    || typeof clip.url !== 'string'
    || typeof clip.title !== 'string'
    || typeof clip.contentMarkdown !== 'string'
    || typeof clip.capturedAt !== 'number'
  ) {
    throw { code: 'invalid-request', message: 'Web clipper payload is incomplete' } satisfies BridgeError
  }

  let sourceUrl: URL
  try {
    sourceUrl = new URL(typeof clip.canonicalUrl === 'string' ? clip.canonicalUrl : clip.url)
  } catch {
    throw { code: 'invalid-request', message: 'Web clipper URL is invalid' } satisfies BridgeError
  }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    throw { code: 'invalid-request', message: 'Only HTTP(S) pages can be clipped' } satisfies BridgeError
  }
  if (clip.clipId.length < 8 || clip.clipId.length > 128 || connection.installId.length > 128) {
    throw { code: 'invalid-request', message: 'Web clipper identifier is invalid' } satisfies BridgeError
  }
  if (new TextEncoder().encode(clip.contentMarkdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw { code: 'content-too-large', message: 'Clipped Markdown exceeds the 2 MiB limit' } satisfies BridgeError
  }
  if (
    typeof clip.plainText === 'string'
    && new TextEncoder().encode(clip.plainText).byteLength > MAX_MARKDOWN_BYTES
  ) {
    throw { code: 'content-too-large', message: 'Clipped text exceeds the 2 MiB limit' } satisfies BridgeError
  }

  const imageUrls = Array.isArray(clip.imageUrls)
    ? clip.imageUrls.filter((value): value is string => {
      if (typeof value !== 'string') return false
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
      } catch {
        return false
      }
    }).slice(0, 30)
    : []

  return {
    connection: {
      id: typeof connection.id === 'string' ? connection.id : '',
      installId: connection.installId,
      origin: typeof connection.origin === 'string' ? connection.origin : '',
      browser: typeof connection.browser === 'string' ? connection.browser : '',
      extensionVersion: typeof connection.extensionVersion === 'string' ? connection.extensionVersion : '',
      createdAt: typeof connection.createdAt === 'number' ? connection.createdAt : 0,
      lastUsedAt: typeof connection.lastUsedAt === 'number' ? connection.lastUsedAt : 0,
    },
    clip: {
      protocolVersion: 1,
      clipId: clip.clipId,
      mode,
      tagId: clip.tagId,
      url: clip.url,
      canonicalUrl: sourceUrl.href,
      title: clip.title.trim().slice(0, 500) || sourceUrl.hostname,
      contentMarkdown: clip.contentMarkdown,
      plainText: typeof clip.plainText === 'string' ? clip.plainText : undefined,
      imageUrls,
      byline: typeof clip.byline === 'string' ? clip.byline.slice(0, 500) : undefined,
      siteName: typeof clip.siteName === 'string' ? clip.siteName.slice(0, 500) : undefined,
      publishedAt: typeof clip.publishedAt === 'string' ? clip.publishedAt.slice(0, 100) : undefined,
      capturedAt: clip.capturedAt,
    },
  }
}

function readTagName(value: unknown) {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw { code: 'invalid-request', message: 'Invalid tag payload' } satisfies BridgeError
  }
  const name = value.name.trim()
  if (!name || Array.from(name).length > 100) {
    throw { code: 'invalid-tag-name', message: 'Tag name must contain between 1 and 100 characters' } satisfies BridgeError
  }
  return name
}

function toBridgeError(error: unknown): BridgeError {
  if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'internal-error',
    message: error instanceof Error ? error.message : String(error),
  }
}

async function resolveRequest(
  requestId: string,
  result?: unknown,
  error?: BridgeError
) {
  await invoke('resolve_web_clipper_request', {
    body: {
      requestId,
      result: result ?? null,
      error: error ?? null,
    },
  })
}

async function refreshRecordStores() {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useMarkStore.getState().fetchMarks(),
  ])
  useTagStore.getState().getCurrentTag()
  emitter.emit(EmitterRecordEvents.refreshMarks)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function imageDataUrl(bytes: Uint8Array, extension: string) {
  const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

async function saveSelectionRecords(connection: WebClipperConnection, clip: WebClipperClip) {
  const sourceId = `web-clipper:${connection.installId}:${clip.clipId}`
  const text = clip.contentMarkdown.trim() || clip.plainText?.trim() || ''
  const savedText = await insertExternalMark({
    sourceId: `${sourceId}:text`,
    tagId: clip.tagId,
    type: 'text',
    desc: (clip.plainText?.trim() || text).slice(0, 500),
    content: text,
  })
  let created = !savedText.duplicate
  const pendingImages: Array<{ imageUrl: string; index: number; mark: Mark }> = []

  for (const [index, imageUrl] of (clip.imageUrls || []).entries()) {
    const savedImage = await insertExternalMark({
      sourceId: `${sourceId}:image:${index}`,
      tagId: clip.tagId,
      type: 'image',
      desc: clip.title,
      content: '',
      url: imageUrl,
    })
    created ||= !savedImage.duplicate
    if (
      !savedImage.duplicate
      || (!savedImage.mark.content && /^https?:\/\//i.test(savedImage.mark.url))
    ) {
      pendingImages.push({ imageUrl, index, mark: savedImage.mark })
    }
  }

  return {
    saved: { ...savedText, duplicate: !created },
    pendingImages,
  }
}

async function recognizeSelectionImages(
  clip: WebClipperClip,
  pendingImages: Array<{ imageUrl: string; index: number; mark: Mark }>
) {
  const { enableImageRecognition, primaryModel } = useSettingStore.getState()
  if (!enableImageRecognition || pendingImages.length === 0) return

  let updated = false
  for (const { imageUrl, index, mark } of pendingImages) {
    try {
      const cached = await cacheCapturedRecordImage(
        imageUrl,
        clip.canonicalUrl || clip.url,
        `${clip.clipId}-${index + 1}`
      )
      const recognition = await recognizeImageWithFallback({
        imagePath: cached.imagePath,
        base64: imageDataUrl(cached.bytes, cached.extension),
        shouldGenerateDescription: Boolean(primaryModel),
      })
      await updateMark({
        ...mark,
        desc: recognition.desc || clip.title,
        content: recognition.content,
        url: cached.filename,
      })
      updated = true
    } catch (error) {
      console.warn('Failed to recognize a web clipper image:', imageUrl, error)
    }
  }
  if (updated) await refreshRecordStores()
}

async function createLinkRecord(connection: WebClipperConnection, clip: WebClipperClip) {
  const sourceId = `web-clipper:${connection.installId}:${clip.clipId}`
  return insertExternalMark({
    sourceId,
    tagId: clip.tagId,
    type: 'link',
    desc: clip.title,
    content: '',
    url: clip.canonicalUrl || clip.url,
  })
}

async function enrichLinkRecord(mark: Mark, clip: WebClipperClip) {
  let shouldCleanup = false
  try {
    const page = await captureLink(clip.canonicalUrl || clip.url)
    const localized = await localizeCapturedImages(page, clip.clipId)
    shouldCleanup = localized.savedPaths.length > 0
    await updateMark({
      ...mark,
      desc: page.title || clip.title,
      content: localized.contentMarkdown || page.excerpt || '',
      url: page.canonicalUrl || page.finalUrl || clip.url,
    })
    shouldCleanup = false
    await refreshRecordStores()
  } catch (error) {
    if (shouldCleanup) {
      await removeLinkAssetGroup(clip.clipId)
    }
    console.warn('Failed to enrich a web clipper link record:', clip.url, error)
  }
}

export function WebClipperBridge() {
  const t = useTranslations('settings.webClipper')
  const { toast } = useToast()
  const [pairing, setPairing] = useState<WebClipperPairingRequest | null>(null)
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    let disposed = false
    let unlistenPairing: (() => void) | undefined
    let unlistenRequest: (() => void) | undefined

    const start = async () => {
      unlistenPairing = await listen<WebClipperPairingRequest>('web-clipper://pairing-request', event => {
        setPairing(event.payload)
      })
      unlistenRequest = await listen<WebClipperBridgeRequest>('web-clipper://request', event => {
        const request = event.payload
        void (async () => {
          try {
            if (request.kind === 'context') {
              const tags = await getTags()
              const defaultTagId = await getDefaultRecordSaveTagId()
              await resolveRequest(request.requestId, {
                protocolVersion: 1,
                tags: tags.map(tag => ({ id: tag.id, name: tag.name })),
                defaultTagId,
              })
              return
            }

            if (request.kind === 'createTag') {
              const name = readTagName(request.payload)
              await resolveRequest(request.requestId, await createOrFindTag(name))
              return
            }

            const { connection, clip } = readClipPayload(request.payload)
            const tags = await getTags()
            if (!tags.some(tag => tag.id === clip.tagId)) {
              throw { code: 'invalid-tag', message: 'The selected NoteGen tag no longer exists' } satisfies BridgeError
            }
            const selection = clip.mode === 'selection'
              ? await saveSelectionRecords(connection, clip)
              : null
            const saved = selection?.saved || await createLinkRecord(connection, clip)
            await resolveRequest(request.requestId, {
              status: saved.duplicate ? 'duplicate' : 'created',
              markId: saved.mark.id,
            })
            if (!saved.duplicate) {
              void (async () => {
                await useSettingStore.getState().setLastRecordTagId(clip.tagId)
                await refreshRecordStores()
                toast({
                  title: t('savedTitle'),
                  description: t('savedDescription', { title: clip.title }),
                })
              })()
            }
            if (selection) {
              void recognizeSelectionImages(clip, selection.pendingImages)
            } else if (!saved.duplicate || !saved.mark.content) {
              void enrichLinkRecord(saved.mark, clip)
            }
          } catch (error) {
            try {
              await resolveRequest(request.requestId, undefined, toBridgeError(error))
            } catch (resolveError) {
              console.warn('Failed to resolve web clipper request:', resolveError)
            }
          }
        })()
      })
      await invoke('set_web_clipper_ready', { ready: true })

      if (disposed) {
        unlistenPairing?.()
        unlistenRequest?.()
        await invoke('set_web_clipper_ready', { ready: false })
      }
    }

    void start()
    return () => {
      disposed = true
      unlistenPairing?.()
      unlistenRequest?.()
      void invoke('set_web_clipper_ready', { ready: false })
    }
  }, [t, toast])

  async function respond(approved: boolean) {
    if (!pairing || responding) return
    setResponding(true)
    try {
      await invoke(approved ? 'approve_web_clipper_pairing' : 'reject_web_clipper_pairing', {
        id: pairing.id,
      })
      setPairing(null)
      toast({
        title: approved ? t('pairingApproved') : t('pairingRejected'),
      })
    } catch (error) {
      toast({
        title: t('pairingFailed'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      setResponding(false)
    }
  }

  return (
    <Dialog open={Boolean(pairing)} onOpenChange={(open) => !open && void respond(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('pairingTitle')}</DialogTitle>
          <DialogDescription>{t('pairingDescription')}</DialogDescription>
        </DialogHeader>
        {pairing ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('browser')}</dt>
            <dd className="truncate">{pairing.browser}</dd>
            <dt className="text-muted-foreground">{t('extensionVersion')}</dt>
            <dd>{pairing.extensionVersion}</dd>
            <dt className="text-muted-foreground">{t('installId')}</dt>
            <dd className="truncate font-mono text-xs">{pairing.installId}</dd>
          </dl>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={responding} onClick={() => void respond(false)}>
            {t('reject')}
          </Button>
          <Button disabled={responding} onClick={() => void respond(true)}>
            {t('approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
