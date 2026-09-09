'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ArchiveIcon,
  BrushCleaningIcon,
  BugIcon,
  CircleAlertIcon,
  ClipboardIcon,
  DatabaseIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { Store } from '@tauri-apps/plugin-store'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { appConfigDir, appDataDir, join } from '@tauri-apps/api/path'
import { exists, remove } from '@tauri-apps/plugin-fs'
import { platform, version as osVersion } from '@tauri-apps/plugin-os'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { save } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { isMobileDevice } from '@/lib/check'

type RecoveryAction =
  | 'exit'
  | 'clear-cache'
  | 'open-data'
  | 'delete-canvas'
  | 'clear-canvases'
  | 'reset-settings'
  | 'export-backup'
  | 'reset-database'
  | 'report-issue'

interface StoredTab {
  id: string
  path: string
  canvasId?: string
}

interface CanvasRecoveryContext {
  id: string
  title?: string
}

interface DiagnosticContext {
  appVersion?: string
  platform?: string
  osVersion?: string
  page?: string
}

const CANVAS_TAB_PREFIX = 'canvas://project/'
const EDITOR_WORKSPACE_LAYOUT_STORE_KEY = 'editorWorkspaceLayout:main'
const TEMPORARY_DIRECTORIES = ['canvas-thumbnails', 'temp_screenshot'] as const
const LAYOUT_STORAGE_KEYS = [
  'leftSidebarVisible',
  'centerPanelVisible',
  'rightSidebarVisible',
  'leftSidebarTab',
  'canvas-manager-view-mode',
  'canvas-manager-sort-mode',
] as const
const LAYOUT_STORAGE_PREFIX = 'react-resizable-panels:main-layout:'
const DATABASE_RESET_PHRASE = '删除数据库'
const GITHUB_BUG_REPORT_URL = 'https://github.com/codexu/note-gen/issues/new'

function getCanvasIdFromTab(tab?: StoredTab) {
  if (!tab) return null
  if (tab.canvasId) return tab.canvasId
  return tab.path.startsWith(CANVAS_TAB_PREFIX)
    ? tab.path.slice(CANVAS_TAB_PREFIX.length) || null
    : null
}

function getSafeRoute() {
  return isMobileDevice() ? '/mobile/chat' : '/core/main'
}

async function clearStartupState() {
  const store = await Store.load('store.json')
  await store.set('openTabs', [])
  await store.set('activeTabId', '')
  await store.set('activeFilePath', '')
  await store.set('currentPage', getSafeRoute())
  await store.delete(EDITOR_WORKSPACE_LAYOUT_STORE_KEY)
  await store.save()
}

function openSafeRoute() {
  window.location.replace('/')
}

export function ErrorRecovery({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [activeAction, setActiveAction] = useState<RecoveryAction | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [canvasContext, setCanvasContext] = useState<CanvasRecoveryContext | null>(null)
  const [diagnosticContext, setDiagnosticContext] = useState<DiagnosticContext>({})
  const [databaseResetOpen, setDatabaseResetOpen] = useState(false)
  const [databaseResetAcknowledged, setDatabaseResetAcknowledged] = useState(false)
  const [databaseResetPhrase, setDatabaseResetPhrase] = useState('')

  useEffect(() => {
    console.error('应用错误:', error)
  }, [error])

  useEffect(() => {
    let cancelled = false

    async function resolveRecoveryContext() {
      const nextDiagnosticContext: DiagnosticContext = {
        page: `${window.location.pathname}${window.location.search}`,
      }
      try {
        nextDiagnosticContext.appVersion = await getVersion()
        nextDiagnosticContext.platform = platform()
        nextDiagnosticContext.osVersion = osVersion()
      } catch (diagnosticError) {
        console.error('读取诊断环境失败:', diagnosticError)
      }
      if (!cancelled) setDiagnosticContext(nextDiagnosticContext)

      try {
        const routeCanvasId = window.location.pathname.includes('/canvas/editor')
          ? new URLSearchParams(window.location.search).get('id')
          : null
        const store = await Store.load('store.json')
        const tabs = await store.get<StoredTab[]>('openTabs') || []
        const activeTabId = await store.get<string>('activeTabId')
        const activeTab = tabs.find(tab => tab.id === activeTabId)
        const canvasId = routeCanvasId || getCanvasIdFromTab(activeTab)
        if (!canvasId || cancelled) return

        let title: string | undefined
        try {
          const { getCanvasProject } = await import('@/db/canvases')
          title = (await getCanvasProject(canvasId))?.title
        } catch (contextError) {
          console.error('读取异常画布信息失败:', contextError)
        }
        if (!cancelled) setCanvasContext({ id: canvasId, title })
      } catch (contextError) {
        console.error('识别异常画布失败:', contextError)
      }
    }

    void resolveRecoveryContext()
    return () => {
      cancelled = true
    }
  }, [])

  async function runRecovery(action: RecoveryAction, task: () => Promise<void>) {
    setActiveAction(action)
    setActionError('')
    setActionMessage('')
    try {
      await task()
    } catch (recoveryError) {
      console.error('恢复操作失败:', recoveryError)
      setActionError(recoveryError instanceof globalThis.Error ? recoveryError.message : '恢复操作失败，请重试')
      setActiveAction(null)
    }
  }

  function exitErrorPage() {
    void runRecovery('exit', async () => {
      await clearStartupState()
      openSafeRoute()
    })
  }

  function clearTemporaryData() {
    void runRecovery('clear-cache', async () => {
      const dataDirectory = await appDataDir()
      for (const directory of TEMPORARY_DIRECTORIES) {
        const path = await join(dataDirectory, directory)
        if (await exists(path)) {
          await remove(path, { recursive: true })
        }
      }
      for (const key of LAYOUT_STORAGE_KEYS) {
        window.localStorage.removeItem(key)
      }
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith(LAYOUT_STORAGE_PREFIX)) {
          window.localStorage.removeItem(key)
        }
      }
      setActionMessage('临时缓存和界面布局已清理，可以重新加载或返回应用。')
      setActiveAction(null)
    })
  }

  function openDataDirectory() {
    void runRecovery('open-data', async () => {
      const configDirectory = await appConfigDir()
      const databasePath = await join(configDirectory, 'note.db')
      if (await exists(databasePath)) {
        await revealItemInDir(databasePath)
      } else {
        await openPath(configDirectory)
      }
      setActionMessage('已在文件管理器中打开数据目录。修改文件前请先退出 NoteGen 并做好备份。')
      setActiveAction(null)
    })
  }

  function deleteCurrentCanvas() {
    if (!canvasContext) return
    void runRecovery('delete-canvas', async () => {
      const { getCanvasProject, softDeleteCanvasProject } = await import('@/db/canvases')
      const project = await getCanvasProject(canvasContext.id)
      await softDeleteCanvasProject(canvasContext.id)
      if (project?.thumbnailPath) {
        const { removeCanvasThumbnail } = await import('@/lib/canvas/thumbnail')
        await removeCanvasThumbnail(project.thumbnailPath)
      }
      await clearStartupState()
      openSafeRoute()
    })
  }

  function clearAllCanvases() {
    void runRecovery('clear-canvases', async () => {
      const { clearCanvasProjects } = await import('@/db/canvases')
      await clearCanvasProjects()
      const thumbnailDirectory = await join(await appDataDir(), 'canvas-thumbnails')
      if (await exists(thumbnailDirectory)) {
        await remove(thumbnailDirectory, { recursive: true })
      }
      await clearStartupState()
      openSafeRoute()
    })
  }

  function resetSettings() {
    void runRecovery('reset-settings', async () => {
      const store = await Store.load('store.json')
      await store.clear()
      await store.set('currentPage', getSafeRoute())
      await store.save()
      openSafeRoute()
    })
  }

  function resetLocalDatabase() {
    if (!databaseResetAcknowledged || databaseResetPhrase !== DATABASE_RESET_PHRASE) return
    void runRecovery('reset-database', async () => {
      try {
        await clearStartupState()
      } catch (startupStateError) {
        console.warn('清理启动状态失败，将继续重置数据库:', startupStateError)
      }

      try {
        const { db } = await import('@/db')
        await db.close()
      } catch (databaseCloseError) {
        console.warn('数据库连接未打开或关闭失败，将继续尝试删除:', databaseCloseError)
      }

      await invoke('delete_local_database')
      await relaunch()
    })
  }

  function exportFullBackup() {
    void runRecovery('export-backup', async () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const outputPath = await save({
        title: '导出 NoteGen 完整数据备份',
        defaultPath: `note-gen-full-backup-${timestamp}.zip`,
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip'],
        }],
      })

      if (!outputPath) {
        setActiveAction(null)
        return
      }

      const savedPath = await invoke<string>('export_app_data', { outputPath })
      setActionMessage(`完整数据备份已导出到：${savedPath}`)
      setActiveAction(null)
    })
  }

  function handleDatabaseResetOpenChange(open: boolean) {
    setDatabaseResetOpen(open)
    if (!open) {
      setDatabaseResetAcknowledged(false)
      setDatabaseResetPhrase('')
    }
  }

  function getErrorDetails() {
    return [
      `错误：${error.message || '未知错误'}`,
      error.digest ? `错误编号：${error.digest}` : '',
      diagnosticContext.appVersion ? `NoteGen：${diagnosticContext.appVersion}` : '',
      diagnosticContext.platform ? `系统：${diagnosticContext.platform} ${diagnosticContext.osVersion || ''}`.trim() : '',
      `页面：${diagnosticContext.page || window.location.href}`,
      `时间：${new Date().toISOString()}`,
      error.stack ? `\n${error.stack}` : '',
    ].filter(Boolean).join('\n')
  }

  async function copyErrorDetails() {
    try {
      await navigator.clipboard.writeText(getErrorDetails())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (clipboardError) {
      console.error('复制错误信息失败:', clipboardError)
      setActionError('无法复制错误信息，请检查剪贴板权限')
    }
  }

  const busy = activeAction !== null
  const mobile = isMobileDevice()

  function reportGitHubIssue() {
    void runRecovery('report-issue', async () => {
      let diagnosticsCopied = false
      try {
        await navigator.clipboard.writeText(getErrorDetails())
        diagnosticsCopied = true
      } catch (clipboardError) {
        console.error('复制 GitHub 反馈信息失败:', clipboardError)
      }

      const issueUrl = new URL(GITHUB_BUG_REPORT_URL)
      issueUrl.searchParams.set('template', 'bug_report.yml')
      issueUrl.searchParams.set('title', '[bug] 应用进入错误恢复模式')
      await openUrl(issueUrl)
      setActionMessage(
        diagnosticsCopied
          ? '已打开 GitHub Bug 反馈页面，错误信息也已复制，请粘贴到报错日志中并补充复现步骤。'
          : '已打开 GitHub Bug 反馈页面，请补充错误信息和复现步骤。'
      )
      setActiveAction(null)
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <CircleAlertIcon />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Badge variant="secondary" className="self-start">恢复模式</Badge>
              <CardTitle>当前页面无法正常打开</CardTitle>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>错误详情</AlertTitle>
            <AlertDescription className="max-h-24 overflow-auto break-words font-mono text-xs">
              {error.message || '未知错误'}
            </AlertDescription>
          </Alert>

          {actionError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>恢复失败</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {actionMessage ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>操作完成</AlertTitle>
              <AlertDescription>{actionMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Card size="sm">
            <CardHeader>
              <CardTitle>按顺序尝试恢复</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion
                type="single"
                collapsible
                defaultValue="level-1"
                className="rounded-lg border px-3"
              >
                <AccordionItem value="level-1">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">第 1 级</Badge>
                      重新进入应用
                      <Badge variant="outline">基本无损</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>本级会清理什么</AlertTitle>
                      <AlertDescription>
                        “重新加载”不会清理任何内容；“退出异常页面”只清除上次打开的页面、活动标签和文件定位状态。
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>本级不会清理什么</AlertTitle>
                      <AlertDescription>
                        不会删除笔记、记录、画布、聊天、数据库、附件或应用设置。
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={reset} disabled={busy}>
                        <RefreshCwIcon data-icon="inline-start" />
                        重新加载当前页面
                      </Button>
                      <Button onClick={exitErrorPage} disabled={busy}>
                        {activeAction === 'exit'
                          ? <Spinner data-icon="inline-start" />
                          : <ArrowLeftIcon data-icon="inline-start" />}
                        退出异常页面
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="level-2">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">第 2 级</Badge>
                      清理缓存与布局
                      <Badge variant="outline">低风险</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    <Alert>
                      <BrushCleaningIcon />
                      <AlertTitle>本级会清理什么</AlertTitle>
                      <AlertDescription>
                        清除画布缩略图、临时截图，以及左右侧栏、面板宽度和画布列表视图等界面布局缓存。这些内容可以重新生成。
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>本级不会清理什么</AlertTitle>
                      <AlertDescription>
                        不会删除笔记正文、记录、画布项目、聊天、模型配置、同步配置或数据库。
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={clearTemporaryData} disabled={busy}>
                        {activeAction === 'clear-cache'
                          ? <Spinner data-icon="inline-start" />
                          : <BrushCleaningIcon data-icon="inline-start" />}
                        清理缓存与布局
                      </Button>
                      {!mobile ? (
                        <Button variant="ghost" onClick={openDataDirectory} disabled={busy}>
                          {activeAction === 'open-data'
                            ? <Spinner data-icon="inline-start" />
                            : <FolderOpenIcon data-icon="inline-start" />}
                          打开数据目录
                        </Button>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="level-3">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">第 3 级</Badge>
                      重置指定数据
                      <Badge variant="outline">需要确认</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    {canvasContext ? (
                      <Alert>
                        <Trash2Icon />
                        <AlertTitle>当前异常画布</AlertTitle>
                        <AlertDescription>
                          只将当前画布移入画布回收站并删除其缩略图；其他画布、笔记、记录和设置不受影响。
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <Alert>
                      <DatabaseIcon />
                      <AlertTitle>全部本地画布</AlertTitle>
                      <AlertDescription>
                        永久清除所有本地画布项目及缩略图；不会删除 Markdown 笔记、记录、聊天、设置或其他数据库内容。
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <RotateCcwIcon />
                      <AlertTitle>应用设置</AlertTitle>
                      <AlertDescription>
                        清除界面、模型、同步、工作区和启动状态等设置；不会删除笔记文件、记录文件和画布数据库。
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      {canvasContext ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={busy}>
                              {activeAction === 'delete-canvas'
                                ? <Spinner data-icon="inline-start" />
                                : <Trash2Icon data-icon="inline-start" />}
                              删除当前异常画布
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>删除当前异常画布？</AlertDialogTitle>
                              <AlertDialogDescription>
                                {canvasContext.title
                                  ? `“${canvasContext.title}”将被移入画布回收站，其他画布和笔记不受影响。`
                                  : '当前画布将被移入画布回收站，其他画布和笔记不受影响。'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={deleteCurrentCanvas}>
                                移入回收站
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={busy}>
                            {activeAction === 'clear-canvases'
                              ? <Spinner data-icon="inline-start" />
                              : <DatabaseIcon data-icon="inline-start" />}
                            清空全部本地画布
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>清空全部本地画布？</AlertDialogTitle>
                            <AlertDialogDescription>
                              所有本地画布及缩略图都会被永久删除，笔记和记录不受影响。此操作无法撤销。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={clearAllCanvases}>
                              确认清空
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={busy}>
                            {activeAction === 'reset-settings'
                              ? <Spinner data-icon="inline-start" />
                              : <RotateCcwIcon data-icon="inline-start" />}
                            重置应用设置
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>重置应用设置？</AlertDialogTitle>
                            <AlertDialogDescription>
                              将清除界面、模型、同步和工作区等设置，但不会删除本地笔记、记录和画布数据库。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={resetSettings}>
                              确认重置
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {!mobile ? (
                  <AccordionItem value="level-4">
                    <AccordionTrigger>
                      <span className="flex items-center gap-2">
                        <Badge variant="destructive">第 4 级</Badge>
                        删除本地数据库
                        <Badge variant="destructive">不可撤销</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-3">
                      <Alert variant="destructive">
                        <CircleAlertIcon />
                        <AlertTitle>本级会永久清理什么</AlertTitle>
                        <AlertDescription>
                          删除画布、聊天、记录索引、标签、向量数据、记忆和活动记录等本地数据库内容，并重启 NoteGen。
                        </AlertDescription>
                      </Alert>
                      <Alert>
                        <InfoIcon />
                        <AlertTitle>本级不会清理什么</AlertTitle>
                        <AlertDescription>
                          不会删除 Markdown 文件、附件目录和录音文件目录。
                        </AlertDescription>
                      </Alert>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={exportFullBackup} disabled={busy}>
                          {activeAction === 'export-backup'
                            ? <Spinner data-icon="inline-start" />
                            : <ArchiveIcon data-icon="inline-start" />}
                          导出完整数据备份
                        </Button>
                        <AlertDialog open={databaseResetOpen} onOpenChange={handleDatabaseResetOpenChange}>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={busy}>
                              {activeAction === 'reset-database'
                                ? <Spinner data-icon="inline-start" />
                                : <DatabaseIcon data-icon="inline-start" />}
                              进入数据库删除确认
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>永久删除本地数据库？</AlertDialogTitle>
                              <AlertDialogDescription>
                                这是最后一级恢复操作。NoteGen 将关闭数据库、删除数据库文件并重启，此操作无法撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>

                            <Alert variant="destructive">
                              <CircleAlertIcon />
                              <AlertTitle>将永久删除</AlertTitle>
                              <AlertDescription>
                                画布、聊天、记录索引、标签、向量数据、记忆和活动记录等数据库内容。Markdown 文件、附件和录音文件目录不会被删除。
                              </AlertDescription>
                            </Alert>

                            <Field orientation="horizontal">
                              <Checkbox
                                id="database-reset-acknowledgement"
                                checked={databaseResetAcknowledged}
                                onCheckedChange={checked => setDatabaseResetAcknowledged(checked === true)}
                              />
                              <FieldLabel htmlFor="database-reset-acknowledgement">
                                我已确认重要数据不需要保留或已经完成备份
                              </FieldLabel>
                            </Field>

                            <Field>
                              <FieldLabel htmlFor="database-reset-phrase">
                                输入“{DATABASE_RESET_PHRASE}”进行最终确认
                              </FieldLabel>
                              <Input
                                id="database-reset-phrase"
                                value={databaseResetPhrase}
                                onChange={event => setDatabaseResetPhrase(event.target.value)}
                                autoComplete="off"
                                placeholder={DATABASE_RESET_PHRASE}
                              />
                              <FieldDescription>
                                必须同时勾选上方确认项并输入完全一致的文字。
                              </FieldDescription>
                            </Field>

                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                disabled={!databaseResetAcknowledged || databaseResetPhrase !== DATABASE_RESET_PHRASE}
                                onClick={resetLocalDatabase}
                              >
                                永久删除并重启
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </CardContent>
          </Card>
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void copyErrorDetails()}>
              <ClipboardIcon data-icon="inline-start" />
              {copied ? '已复制' : '复制错误信息'}
            </Button>
            <Button variant="ghost" size="sm" onClick={reportGitHubIssue} disabled={busy}>
              {activeAction === 'report-issue'
                ? <Spinner data-icon="inline-start" />
                : <BugIcon data-icon="inline-start" />}
              反馈 GitHub Issue
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  )
}
