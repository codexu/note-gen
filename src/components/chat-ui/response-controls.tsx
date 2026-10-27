"use client"

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { convertFileSrc } from '@tauri-apps/api/core'
import { writeText } from 'tauri-plugin-clipboard-api'
import { type ResponseAction, type ResponseComponentProps, isResponseImageUrl } from '@/lib/chat-ui/response-catalog'
import { assertResponseWorkspace, verifyResponseNote } from '@/lib/chat-ui/response-host'
import { toWorkspaceRelativePath } from '@/lib/workspace'
import { openChatArtifact, resolveChatArtifact, saveChatArtifactAs } from '@/lib/chat-artifacts'
import { createCanvasTab } from '@/app/core/main/canvas/canvas-tab'
import useArticleStore from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { useSidebarStore } from '@/stores/sidebar'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ResponseIcon } from './response-icon'
import { useChatResponseContext } from './response-context'

function useResponseAction() {
  const context = useChatResponseContext()
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('record.chat.response')
  const checkWorkspace = () => assertResponseWorkspace(context.workspaceFingerprint)
  const openNote = async (path: string) => {
    await checkWorkspace()
    const target = await verifyResponseNote(path)
    await checkWorkspace()
    await useArticleStore.getState().setActiveFilePath(target, true,
      pathname.startsWith('/mobile') ? undefined : { tabOpenMode: 'preview' })
    await checkWorkspace()
    if (pathname.startsWith('/mobile') && useArticleStore.getState().activeFilePath === target) router.push('/mobile/writing')
  }
  return async (action: ResponseAction) => {
    if (context.isPreview) return
    if (action.type === 'copy') {
      await writeText(action.text)
      toast({ title: t('copied') })
      return
    }
    await checkWorkspace()
    if (action.type === 'open-note') return openNote(action.path)
    if (action.type === 'open-source') {
      const source = context.sources.find(item => item.sourceKey === action.sourceKey)
      if (!source) throw new Error('RESPONSE_SOURCE_UNAVAILABLE')
      if (source.sourceType === 'record' && source.locator?.markId) {
        if (source.locator.tagId) await useTagStore.getState().setCurrentTagId(source.locator.tagId)
        await checkWorkspace()
        await useMarkStore.getState().fetchMarks()
        await checkWorkspace()
        useMarkStore.getState().setPendingScrollMarkId(source.locator.markId)
        useMarkStore.getState().setHighlightedMarkId(source.locator.markId)
        await useSidebarStore.getState().setLeftSidebarTab('notes')
        if (pathname.startsWith('/mobile')) router.push('/mobile/record')
        return
      }
      if (source.sourceType === 'canvas' && source.locator?.canvasId) {
        const canvasId = source.locator.canvasId
        const project = await useCanvasStore.getState().openProject(canvasId)
        await checkWorkspace()
        if (!project) throw new Error('RESPONSE_SOURCE_UNAVAILABLE')
        useCanvasStore.getState().setPendingFocus({ canvasId, nodeIds: source.locator.nodeIds ?? [] })
        if (pathname.startsWith('/mobile')) router.push(`/mobile/canvas/editor?id=${encodeURIComponent(canvasId)}`)
        else {
          await useArticleStore.getState().addTab(createCanvasTab(project))
          await useSidebarStore.getState().setLeftSidebarTab('canvases')
        }
        return
      }
      const path = source.locator?.filePath || source.filepath
      if (!path) throw new Error('RESPONSE_SOURCE_UNAVAILABLE')
      return openNote(await toWorkspaceRelativePath(path))
    }
    const artifact = context.artifacts.artifacts.find(item => item.path === action.path || item.absolutePath === action.path)
    if (!artifact) throw new Error('RESPONSE_ARTIFACT_UNAVAILABLE')
    const access = { allowedPaths: context.artifacts.allowedPaths }
    if (action.type === 'open-artifact') await openChatArtifact(artifact.absolutePath, access)
    else if (await saveChatArtifactAs(artifact.absolutePath, access)) toast({ title: t('saved') })
  }
}

const actionIcons = {
  copy: 'copy', 'open-note': 'file-text', 'open-source': 'book-open',
  'open-artifact': 'external-link', 'save-artifact': 'download',
} as const

export function ResponseActionButton({ action, variant = 'outline' }: {
  action: ResponseAction
  variant?: 'outline' | 'link'
}) {
  const t = useTranslations('record.chat.response')
  const context = useChatResponseContext()
  const run = useResponseAction()
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const referenceAvailable = action.type === 'open-source' ? context.sources.some(source => source.sourceKey === action.sourceKey)
    : action.type === 'open-artifact' || action.type === 'save-artifact'
      ? context.artifacts.artifacts.some(artifact => artifact.path === action.path || artifact.absolutePath === action.path)
      : true
  const available = !context.isPreview && referenceAvailable
  const perform = async () => {
    if (context.isPreview || busy.current) return
    busy.current = true
    setPending(true)
    try { await run(action) }
    catch { toast({ title: t('actionFailed'), description: t('unavailable'), variant: 'destructive' }) }
    finally { busy.current = false; setPending(false) }
  }
  return <Button type="button" variant={variant} size="sm" className="max-w-full" disabled={!available || pending}
    title={context.isPreview ? t('previewActions') : !available ? t('unavailable') : action.label} onClick={() => void perform()}>
    {pending ? <Spinner data-icon="inline-start" /> : <ResponseIcon name={action.icon ?? actionIcons[action.type]} data-icon="inline-start" />}
    <span className="truncate">{action.label}</span>
  </Button>
}

export function ResponseNoteLink({ path, label, icon }: ResponseComponentProps<'NoteLink'>) {
  return <ResponseActionButton action={{ type: 'open-note', path, label: label || path.split(/[\\/]/).pop() || path, icon }} variant="link" />
}

export function ResponseArtifactLink({ path, label, icon }: ResponseComponentProps<'ArtifactLink'>) {
  const t = useTranslations('record.chat.response')
  return <div className="flex flex-wrap items-center gap-2">
    <ResponseActionButton action={{ type: 'open-artifact', path, label: label || path.split(/[\\/]/).pop() || path, icon }} />
    <ResponseActionButton action={{ type: 'save-artifact', path, label: t('saveArtifact') }} />
  </div>
}

export function ResponseSources({ title, items }: ResponseComponentProps<'Sources'>) {
  return <section className="flex min-w-0 flex-col gap-1">
    {title && <h3 className="break-words font-medium">{title}</h3>}
    <ul className="flex min-w-0 flex-col gap-1">{items.map((item, index) => <li key={index}>
      <ResponseActionButton action={{ type: 'open-source', sourceKey: item.sourceKey, label: item.label }} variant="link" />
    </li>)}</ul>
  </section>
}

export function ResponseQuote({ text, attribution, sourceKey }: ResponseComponentProps<'Quote'>) {
  const { sources } = useChatResponseContext()
  const t = useTranslations('record.chat.response')
  const source = sources.find(item => item.sourceKey === sourceKey)
  return <blockquote className="flex min-w-0 flex-col gap-2 border-l-2 pl-4">
    <p className="whitespace-pre-wrap break-words">{text}</p>
    {attribution && <footer className="break-words text-sm text-muted-foreground">{attribution}</footer>}
    {sourceKey && <ResponseActionButton action={{ type: 'open-source', sourceKey, label: source?.filename || t('openSource') }} variant="link" />}
  </blockquote>
}

export function ResponseActionGroup({ actions }: ResponseComponentProps<'ActionGroup'>) {
  return <div className="flex flex-wrap items-center gap-2">{actions.map((action, index) => <ResponseActionButton key={index} action={action} />)}</div>
}

export function ResponseImage({ src, alt, caption }: ResponseComponentProps<'Image'>) {
  const context = useChatResponseContext()
  const t = useTranslations('record.chat.response')
  const [resolved, setResolved] = useState<{ source: string; url?: string; failed?: boolean }>()
  useEffect(() => {
    if (context.isPreview) return
    let cancelled = false
    const resolve = async () => {
      if (isResponseImageUrl(src)) return src
      await assertResponseWorkspace(context.workspaceFingerprint)
      const artifact = context.artifacts.artifacts.find(item => item.path === src || item.absolutePath === src)
      if (!artifact) throw new Error('RESPONSE_IMAGE_UNAVAILABLE')
      const file = await resolveChatArtifact(artifact.absolutePath, { allowedPaths: context.artifacts.allowedPaths })
      await assertResponseWorkspace(context.workspaceFingerprint)
      return convertFileSrc(file.absolutePath)
    }
    void resolve().then(url => { if (!cancelled) setResolved({ source: src, url }) })
      .catch(() => { if (!cancelled) setResolved({ source: src, failed: true }) })
    return () => { cancelled = true }
  }, [src, context.artifacts, context.workspaceFingerprint, context.isPreview])
  const current = !context.isPreview && resolved?.source === src ? resolved : undefined
  return <figure className="flex min-w-0 flex-col gap-2">
    {current?.failed ? <Alert><AlertDescription>{t('imageFailed')} {alt}</AlertDescription></Alert>
      : current?.url ? <img src={current.url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        className="h-auto max-w-full rounded-lg" onError={() => setResolved({ source: src, failed: true })} />
        : <p className="text-sm text-muted-foreground">{alt}</p>}
    {caption && <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>}
  </figure>
}
