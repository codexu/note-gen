'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { readTextFile, stat } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createRecordTab } from '@/app/core/main/mark/mark-record-tab'
import { createCanvasTab } from '@/app/core/main/canvas/canvas-tab'
import { getCanvasProject } from '@/db/canvases'
import { getMarkById, getRecordLocatorBySourceId } from '@/db/marks'
import { getFilePathOptions, isAbsoluteFsPath, toWorkspaceRelativePath } from '@/lib/workspace'
import { assertResponseWorkspace, verifyResponseNote } from '@/lib/chat-ui/response-host'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import useArticleStore from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'
import type { RagSourceDetail } from '@/types/knowledge'

type Source = Partial<Pick<RagSourceDetail, 'sourceType' | 'sourceKey' | 'stableId' | 'locator' | 'filename' | 'filepath' | 'originalContentHash' | 'content' | 'evidenceKind'>> & { requiresArticleEvidence?: boolean }
type LocalTarget =
  | { type: 'record'; markId: number }
  | { type: 'canvas'; canvasId: string; nodeIds: string[] }
  | { type: 'article'; path: string }

function hasOriginalExcerpt(source: Source, text: string) {
  if (source.evidenceKind === 'wiki' || !source.content) return false
  const excerpt = source.content.replace(/\r\n?/g, '\n').trim()
  const original = text.replace(/\r\n?/g, '\n').trim()
  return Boolean(excerpt) && (excerpt === original || (excerpt.length >= 32 && original.includes(excerpt)))
}

async function resolveTarget(source: Source, fingerprint?: string | null, structured = false): Promise<LocalTarget | null> {
  if (fingerprint) await assertResponseWorkspace(fingerprint)
  if (source.sourceType === 'record') {
    const stableId = source.stableId
    let record
    if (stableId?.startsWith('record:') && !stableId.startsWith('record:legacy-original:')) {
      record = await getRecordLocatorBySourceId(stableId.slice('record:'.length))
    } else if (source.locator?.markId) {
      record = await getMarkById(source.locator.markId)
      if (record) {
        const { getRecordKnowledgeDocument } = await import('@/lib/knowledge-content')
        const document = await getRecordKnowledgeDocument(record)
        if (!document) return null
        const expectedHash = stableId?.replace(/^record:legacy-original:/, '') || source.originalContentHash
        if (expectedHash ? document.contentHash !== expectedHash : !hasOriginalExcerpt(source, document.content)) return null
      }
    }
    return record && !record.deleted ? { type: 'record', markId: record.id } : null
  }
  if (source.sourceType === 'canvas') {
    const canvasId = source.stableId?.startsWith('canvas:') ? source.stableId.slice('canvas:'.length) : source.locator?.canvasId
    if (!canvasId) return null
    const project = await getCanvasProject(canvasId)
    return project && !project.deletedAt ? { type: 'canvas', canvasId, nodeIds: source.locator?.nodeIds ?? [] } : null
  }
  const identity = source.stableId ?? source.sourceKey
  // Old local root notes and synchronized excerpts can both have filepath === filename.
  const knownPath = identity?.startsWith('article:') ? identity.slice('article:'.length) : source.locator?.filePath
  const file = knownPath || source.filepath
  if (!file) return null
  const relative = (isAbsoluteFsPath(file) ? await toWorkspaceRelativePath(file) : file).replaceAll('\\', '/').replace(/^\.\//, '')
  const path = structured ? await verifyResponseNote(relative) : relative
  if (isAbsoluteFsPath(path) || !/\.(md|markdown)$/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return null
  const options = await getFilePathOptions(path)
  const fsOptions = options.baseDir ? { baseDir: options.baseDir } : undefined
  if (source.requiresArticleEvidence || fingerprint === null || (!knownPath && source.filepath === source.filename)) {
    if (!source.originalContentHash && (source.evidenceKind === 'wiki' || !source.content?.trim())) return null
    const text = await readTextFile(options.path, fsOptions)
    if (source.originalContentHash) {
      const { hashKnowledgeContent } = await import('@/lib/knowledge-content')
      const original = source.evidenceKind === 'wiki' ? text.replace(/\r\n?/g, '\n') : text
      if (hashKnowledgeContent(original) !== source.originalContentHash) return null
    } else if (!hasOriginalExcerpt(source, text)) return null
  } else if (!structured && !(await stat(options.path, fsOptions)).isFile) return null
  return { type: 'article', path }
}

export function useKnowledgeSourceLink(source?: Source, fingerprint?: string | null, structured = false) {
  const workspace = useSettingStore(state => state.workspacePath)
  const pathname = usePathname()
  const router = useRouter()
  const recordType = useTranslations('record.mark.type')
  const [result, setResult] = useState<{ source: Source; workspace: typeof workspace; fingerprint?: string | null; available: boolean }>()
  useEffect(() => {
    if (!source) return
    let active = true
    const current = captureWikiWorkspaceGuard()
    const update = (available: boolean) => {
      if (active && current()) setResult({ source, workspace, fingerprint, available })
    }
    void resolveTarget(source, fingerprint, structured).then(target => update(Boolean(target)), () => update(false))
    return () => { active = false }
  }, [source, workspace, fingerprint, structured])

  const open = async () => {
    if (!source) return false
    const current = captureWikiWorkspaceGuard()
    const target = await resolveTarget(source, fingerprint, structured).catch(() => null)
    if (!current()) return false
    if (!target) {
      setResult({ source, workspace, fingerprint, available: false })
      return false
    }
    const mobile = pathname.startsWith('/mobile')
    if (target.type === 'record') {
      if (mobile) {
        router.push(`/mobile/record/detail?id=${target.markId}`)
        return true
      }
      const mark = await getMarkById(target.markId)
      if (!mark || mark.deleted || !current()) return false
      if (source.stableId && !source.stableId.startsWith('record:legacy-original:')
        && source.stableId !== `record:${mark.sourceId}`) return false
      const article = useArticleStore.getState()
      const tab = createRecordTab(mark, recordType(mark.type))
      await article.addTab(tab)
      if (!current() || useArticleStore.getState().activeTabId !== tab.id) return false
      useMarkStore.getState().setActiveMarkId(mark.id)
      await article.setActiveFilePath('')
      if (!current()) return false
      await useSidebarStore.getState().showCenterPanel()
    } else if (target.type === 'canvas') {
      const canvas = useCanvasStore.getState()
      const project = await canvas.openProject(target.canvasId)
      if (!project || !current()) return false
      canvas.setPendingFocus({ canvasId: target.canvasId, nodeIds: target.nodeIds })
      if (mobile) router.push(`/mobile/canvas/editor?id=${encodeURIComponent(target.canvasId)}`)
      else {
        await useArticleStore.getState().addTab(createCanvasTab(project))
        if (!current()) return false
        await useSidebarStore.getState().setLeftSidebarTab('canvases')
        if (current()) await useSidebarStore.getState().showCenterPanel()
      }
    } else {
      await useArticleStore.getState().setActiveFilePath(target.path, true, {
        createIfMissing: false, tabOpenMode: mobile ? undefined : 'preview',
      })
      if (!current() || useArticleStore.getState().activeFilePath !== target.path) return false
      if (mobile) router.push('/mobile/writing')
      else await useSidebarStore.getState().showCenterPanel()
    }
    return true
  }
  const available = source && result?.source === source && result.workspace === workspace && result.fingerprint === fingerprint
    ? result.available : undefined
  return { available, open }
}

export function KnowledgeSourceLink({ source, onOpened, articleWorkspace }: {
  source: Source
  onOpened?: () => void
  articleWorkspace?: string | null
}) {
  const t = useTranslations('record.chat.ragSources')
  const fingerprint = source.sourceType === 'record' || source.sourceType === 'canvas' ? undefined : articleWorkspace
  const { available, open } = useKnowledgeSourceLink(source, fingerprint)
  if (available === undefined) return null
  if (!available) return <span className="text-xs text-muted-foreground">{t(source.sourceType === 'record' ? 'recordUnavailable' : 'sourceUnavailable')}</span>
  const label = source.sourceType === 'record' ? 'openRecord' : source.sourceType === 'canvas' ? 'openCanvas'
    : source.sourceType === 'article' ? 'openArticle' : 'openSource'
  return <Button type="button" size="xs" variant="link" onClick={() => {
    void open().then(opened => {
      if (opened) onOpened?.()
      else toast.error(t('sourceUnavailable'))
    }, () => toast.error(t('sourceUnavailable')))
  }}>{t(label)}</Button>
}
