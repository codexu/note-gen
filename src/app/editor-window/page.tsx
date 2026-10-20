'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { platform } from '@tauri-apps/plugin-os'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { MoreHorizontal, Pin, PinOff } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TipTapEditor } from '@/app/core/main/editor/markdown/tiptap-editor'
import useArticleStore from '@/stores/article'
import {
  loadEditorWindowSession,
  removeEditorWindowSession,
  type EditorWindowSession,
} from '@/lib/editor-windows'
import { prepareActiveEditorDeactivation } from '@/lib/editor-deactivation'
import { cn } from '@/lib/utils'
import { setRuntimeWorkspaceRoot } from '@/lib/workspace'
import { PluginCommandPalette } from '@/components/plugins/plugin-command-palette'
import { PluginHostBridge } from '@/components/plugins/plugin-host-bridge'
import useSettingStore, { DEVELOPER_MODE_CHANGED_EVENT } from '@/stores/setting'

export default function EditorWindowPage() {
  const t = useTranslations('editorWindow')
  const tEditor = useTranslations('editor')
  const locale = useLocale()
  const [session, setSession] = useState<EditorWindowSession | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [isMacOS, setIsMacOS] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [pluginSettingsReady, setPluginSettingsReady] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const closingRef = useRef(false)
  const sessionRef = useRef<EditorWindowSession | null>(null)
  const contentRef = useRef('')
  const savedContentRef = useRef('')
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveGenerationRef = useRef(0)

  const queueSave = useCallback((nextContent: string) => {
    const currentSession = sessionRef.current
    if (!currentSession || nextContent === savedContentRef.current) return
    const generation = ++saveGenerationRef.current
    setSaving(true)
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!await exists(currentSession.absolutePath)) {
          throw new Error(t('fileMissing'))
        }
        await writeTextFile(currentSession.absolutePath, nextContent)
        savedContentRef.current = nextContent
        if (contentRef.current === nextContent) setDirty(false)
        setError('')
      })
      .catch(reason => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (saveGenerationRef.current === generation) setSaving(false)
      })
  }, [t])

  const handleContentChange = useCallback((nextContent: string) => {
    contentRef.current = nextContent
    setDirty(nextContent !== savedContentRef.current)
    useArticleStore.setState({ currentArticle: nextContent })
    queueSave(nextContent)
  }, [queueSave])

  const closeWindow = useCallback(async () => {
    const currentSession = sessionRef.current
    if (!currentSession || closingRef.current) return
    if (!prepareActiveEditorDeactivation()) return
    closingRef.current = true
    queueSave(contentRef.current)
    await saveQueueRef.current
    if (savedContentRef.current !== contentRef.current) {
      closingRef.current = false
      setDiscardDialogOpen(true)
      return
    }
    await removeEditorWindowSession(currentSession.id)
    await getCurrentWindow().destroy()
  }, [queueSave])

  const discardAndClose = useCallback(async () => {
    const currentSession = sessionRef.current
    if (!currentSession) return
    closingRef.current = true
    await removeEditorWindowSession(currentSession.id)
    await getCurrentWindow().destroy()
  }, [])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => void) | undefined
    void listen<boolean>(DEVELOPER_MODE_CHANGED_EVENT, (event) => {
      useSettingStore.setState({ developerMode: event.payload === true })
    }).then(async (unlisten) => {
      removeListener = unlisten
      const store = await Store.load('store.json')
      const developerMode = await store.get<boolean>('developerMode') === true
      if (!disposed) {
        useSettingStore.setState({ developerMode })
        setPluginSettingsReady(true)
      }
    }).catch(() => {
      if (!disposed) setPluginSettingsReady(true)
    })
    return () => {
      disposed = true
      removeListener?.()
    }
  }, [])

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('session')
    setIsMacOS(platform() === 'macos')
    if (!id) {
      setError(t('missing'))
      return
    }

    void loadEditorWindowSession(id).then(async storedSession => {
      if (!storedSession) {
        setError(t('missing'))
        return
      }
      setRuntimeWorkspaceRoot(storedSession.workspaceRoot, storedSession.workspaceIsCustom ?? true)
      const initialContent = await readTextFile(storedSession.absolutePath)
      sessionRef.current = storedSession
      contentRef.current = initialContent
      savedContentRef.current = initialContent
      useArticleStore.setState({
        activeFilePath: storedSession.absolutePath,
        currentArticle: initialContent,
        loading: false,
        readFilePath: storedSession.absolutePath,
        openTabs: [storedSession.tab],
        activeTabId: storedSession.tab.id,
      })
      setSession(storedSession)
      setContent(initialContent)
    }).catch(async reason => {
      await removeEditorWindowSession(id).catch(() => undefined)
      setError(reason instanceof Error ? reason.message : String(reason))
    })

    const editorWindow = getCurrentWindow()
    let removeCloseListener: (() => void) | undefined
    void editorWindow.onCloseRequested(event => {
      event.preventDefault()
      if (sessionRef.current) void closeWindow()
      else void editorWindow.destroy()
    }).then(unlisten => {
      removeCloseListener = unlisten
    })
    return () => removeCloseListener?.()
  }, [closeWindow, t])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      queueSave(contentRef.current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [queueSave])

  useEffect(() => {
    if (!session) return
    const status = saving ? ` · ${t('saving')}` : dirty ? ` · ${t('unsaved')}` : ''
    void getCurrentWindow().setTitle(`${session.tab.name}${status}`).catch(error => {
      console.error('Failed to update editor window title:', error)
    })
  }, [dirty, saving, session, t])

  const toggleAlwaysOnTop = useCallback(async () => {
    const next = !alwaysOnTop
    await getCurrentWindow().setAlwaysOnTop(next)
    setAlwaysOnTop(next)
  }, [alwaysOnTop])

  if (error && !session) {
    return <main className="flex min-h-screen items-center justify-center p-8 text-sm text-destructive">{error}</main>
  }
  if (!session || content === null) {
    return <main className="flex min-h-screen items-center justify-center"><Spinner /></main>
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
      <header
        className={cn('flex h-9 shrink-0 items-center border-b bg-background', isMacOS ? 'pl-[70px]' : 'pl-2')}
        data-tauri-drag-region
      >
        {isMacOS ? (
          <div className="min-w-0 flex-1 self-stretch" data-tauri-drag-region />
        ) : (
          <span className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground" title={session.absolutePath} data-tauri-drag-region>
            {session.tab.name}{saving ? ` · ${t('saving')}` : dirty ? ` · ${t('unsaved')}` : ''}
          </span>
        )}
        <div className="flex items-center gap-0.5 px-1">
          <Button variant="ghost" size="icon-sm" onClick={() => void toggleAlwaysOnTop()} aria-label={alwaysOnTop ? t('unpin') : t('pin')}>
            {alwaysOnTop ? <PinOff /> : <Pin />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('more')}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => void toggleAlwaysOnTop()}>
                  {alwaysOnTop ? t('unpin') : t('pin')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => void closeWindow()}>{t('close')}</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {error && <div className="border-b px-3 py-2 text-xs text-destructive">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <TipTapEditor
          initialContent={content}
          onChange={handleContentChange}
          placeholder={tEditor('placeholder')}
          activeFilePath={session.absolutePath}
          applyLayoutPreferences
          isActive
          standalone
        />
      </div>
      <PluginHostBridge
        ready={pluginSettingsReady && Boolean(session)}
        locale={locale}
        surface="editor-window"
      />
      <PluginCommandPalette />
      <AlertDialog
        open={discardDialogOpen}
        onOpenChange={open => {
          setDiscardDialogOpen(open)
          if (!open) closingRef.current = false
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('discardCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void discardAndClose()}>{t('discardConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
