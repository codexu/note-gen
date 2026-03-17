'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, TerminalSquare } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  cancelMcpRuntimeInstall,
  inspectMcpRuntime,
  installMcpRuntime,
  type MCPInstallRecipe,
  type MCPInstallProgressEvent,
  type MCPInstallProgressStage,
  type MCPRuntimeInspection,
} from '@/lib/mcp/runtime-assistant'

type RuntimeDefinition = {
  key: string
  label: string
  command: string
}

const RUNTIMES: RuntimeDefinition[] = [
  { key: 'npx', label: 'Node.js / npx', command: 'npx' },
  { key: 'uvx', label: 'uv / uvx', command: 'uvx' },
  { key: 'bunx', label: 'Bun / bunx', command: 'bunx' },
  { key: 'python3', label: 'Python 3', command: 'python3' },
]

export function RuntimeEnvironmentCard() {
  const t = useTranslations('settings.mcp')
  const { toast } = useToast()
  const [inspections, setInspections] = useState<Record<string, MCPRuntimeInspection>>({})
  const [checkingAll, setCheckingAll] = useState(false)
  const [installingRecipeId, setInstallingRecipeId] = useState<string | null>(null)
  const [installRecipe, setInstallRecipe] = useState<MCPInstallRecipe | null>(null)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [installStage, setInstallStage] = useState<MCPInstallProgressStage>('preparing')
  const [installLogs, setInstallLogs] = useState<string[]>([])
  const activeRecipeIdRef = useRef<string | null>(null)

  const inspectionEntries = useMemo(
    () => RUNTIMES.map((runtime) => ({ runtime, inspection: inspections[runtime.key] })),
    [inspections],
  )

  const hasAnyInspection = useMemo(() => inspectionEntries.some((entry) => Boolean(entry.inspection)), [inspectionEntries])
  const installedCount = useMemo(
    () => inspectionEntries.filter((entry) => entry.inspection?.checks.some((check) => check.installed)).length,
    [inspectionEntries],
  )

  useEffect(() => {
    let unlisten: (() => void) | undefined

    async function bindListener() {
      unlisten = await listen<MCPInstallProgressEvent>('mcp-runtime-install', (event) => {
        const payload = event.payload
        if (!payload || payload.recipeId !== activeRecipeIdRef.current) {
          return
        }

        setInstallStage(payload.stage)
        if (payload.line) {
          const prefix = payload.stream ? `[${payload.stream}] ` : ''
          setInstallLogs((prev) => [...prev, `${prefix}${payload.line}`])
        }
      })
    }

    bindListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const installStageLabel = useMemo(() => {
    switch (installStage) {
      case 'preparing':
        return t('runtimeInstallPreparing')
      case 'running':
        return t('runtimeInstallRunning')
      case 'completed':
        return t('runtimeInstallCompleted')
      case 'cancelled':
        return t('runtimeInstallCancelled')
      case 'failed':
        return t('runtimeInstallFailedState')
      default:
        return t('runtimeInstallPreparing')
    }
  }, [installStage, t])

  const runInspection = async (runtime: RuntimeDefinition) => {
    const inspection = await inspectMcpRuntime(runtime.command)
    setInspections((prev) => ({ ...prev, [runtime.key]: inspection }))
    return inspection
  }

  const handleCheckAll = async () => {
    setCheckingAll(true)
    try {
      await Promise.all(RUNTIMES.map((runtime) => runInspection(runtime)))
    } catch (error) {
      toast({
        description: `${t('runtimeCheckFailed')}: ${error}`,
        variant: 'destructive',
      })
    } finally {
      setCheckingAll(false)
    }
  }

  const handleInstallClick = (recipe: MCPInstallRecipe) => {
    setInstallRecipe(recipe)
    activeRecipeIdRef.current = recipe.id
    setInstallStage('preparing')
    setInstallLogs([])
    setInstallDialogOpen(true)
  }

  const handleConfirmInstall = async () => {
    if (!installRecipe) {
      return
    }

    setInstallingRecipeId(installRecipe.id)
    setInstallStage('preparing')
    setInstallLogs([])
    try {
      const result = await installMcpRuntime(installRecipe.id)
      setInstallStage(result.success ? 'completed' : 'failed')
      toast({
        description: result.success ? t('runtimeInstallSuccess') : t('runtimeInstallFailed'),
        variant: result.success ? 'default' : 'destructive',
      })

      const matchedRuntime = RUNTIMES.find((runtime) => {
        const inspection = inspections[runtime.key]
        return inspection?.installRecipe?.id === installRecipe.id
      })
      if (matchedRuntime) {
        await runInspection(matchedRuntime)
      }
    } catch (error) {
      setInstallStage('failed')
      setInstallLogs((prev) => [...prev, String(error)])
      toast({
        description: `${t('runtimeInstallFailed')}: ${error}`,
        variant: 'destructive',
      })
    } finally {
      setInstallingRecipeId(null)
    }
  }

  const handleInstallDialogOpenChange = (open: boolean) => {
    if (installingRecipeId) {
      return
    }

    setInstallDialogOpen(open)
    if (!open) {
      activeRecipeIdRef.current = null
    }
  }

  const handleCancelInstall = async () => {
    if (!installRecipe) {
      return
    }

    try {
      const result = await cancelMcpRuntimeInstall(installRecipe.id)
      if (result.cancelled) {
        setInstallStage('cancelled')
        setInstallLogs((prev) => [...prev, t('runtimeInstallCancelledByUser')])
      }
    } catch (error) {
      setInstallLogs((prev) => [...prev, `${t('runtimeInstallCancelFailed')}: ${error}`])
      toast({
        description: `${t('runtimeInstallCancelFailed')}: ${error}`,
        variant: 'destructive',
      })
    } finally {
      setInstallingRecipeId(null)
    }
  }

  return (
    <>
      <Card className="p-4 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TerminalSquare className="size-4 text-muted-foreground" />
              <p className="font-medium">{t('runtimeEnvironment')}</p>
              {hasAnyInspection && (
                <Badge variant="outline">
                  {t('runtimeInstalledSummary', { installed: installedCount, total: RUNTIMES.length })}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t('runtimeEnvironmentDesc')}</p>
            <p className="text-xs text-muted-foreground">{t('runtimeCurrentUserScope')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleCheckAll}
            disabled={checkingAll}
          >
            {checkingAll && <Loader2 className="mr-2 size-4 animate-spin" />}
            {hasAnyInspection ? t('recheckEnvironment') : t('checkEnvironment')}
          </Button>
        </div>

        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="w-full justify-between px-2">
              <span>{isOpen ? t('hideRuntimeDetails') : t('showRuntimeDetails')}</span>
              {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="pt-2">
            <div className="grid gap-3">
              {inspectionEntries.map(({ runtime, inspection }) => {
                const isInstalled = inspection?.checks.some((check) => check.installed) ?? false

                return (
                  <div key={runtime.key} className="rounded-lg border p-4 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{runtime.label}</p>
                        <Badge variant="outline">{runtime.command}</Badge>
                        {inspection && (
                          <Badge
                            variant="outline"
                            className={isInstalled ? 'text-green-600 border-green-200' : 'text-amber-600 border-amber-200'}
                          >
                            {isInstalled ? t('runtimeInstalled') : t('runtimeMissing')}
                          </Badge>
                        )}
                      </div>
                      {inspection ? (
                        <p className="text-xs text-muted-foreground">
                          {t('detectedLauncher')}: {inspection.launcher}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t('runtimeNotChecked')}</p>
                      )}
                    </div>

                    {inspection && (
                      <div className="space-y-3">
                        {inspection.checks.map((check) => (
                          <div key={check.command} className="rounded-md border bg-muted/30 p-3 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{check.command}</p>
                                {check.resolvedPath && (
                                  <p className="break-all text-xs text-muted-foreground">{check.resolvedPath}</p>
                                )}
                              </div>
                              <Badge
                                variant="outline"
                                className={check.installed ? 'text-green-600 border-green-200' : 'text-amber-600 border-amber-200'}
                              >
                                {check.installed ? t('runtimeInstalled') : t('runtimeMissing')}
                              </Badge>
                            </div>
                            {check.version && (
                              <p className="text-xs text-muted-foreground">
                                {t('runtimeVersion')}: {check.version}
                              </p>
                            )}
                          </div>
                        ))}

                        {!isInstalled && inspection.installRecipe && (
                          <div className="rounded-md border border-dashed p-3 space-y-3">
                            <div className="flex items-start gap-2">
                              {inspection.installRecipe.manualOnly ? (
                                <AlertTriangle className="size-4 mt-0.5 text-amber-500" />
                              ) : (
                                <CheckCircle2 className="size-4 mt-0.5 text-blue-500" />
                              )}
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{inspection.installRecipe.title}</p>
                                <p className="text-xs text-muted-foreground">{t('runtimeCurrentUserScope')}</p>
                              </div>
                            </div>
                            <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                              {inspection.installRecipe.commandPreview}
                            </pre>
                            {inspection.installRecipe.postInstallHint && (
                              <p className="text-xs text-muted-foreground">
                                {inspection.installRecipe.postInstallHint}
                              </p>
                            )}
                            {inspection.installRecipe.manualOnly ? (
                              <p className="text-xs text-muted-foreground">{t('runtimeManualOnly')}</p>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleInstallClick(inspection.installRecipe!)}
                                disabled={installingRecipeId === inspection.installRecipe.id}
                              >
                                {installingRecipeId === inspection.installRecipe.id && (
                                  <Loader2 className="mr-2 size-4 animate-spin" />
                                )}
                                {t('installRuntime')}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <AlertDialog open={installDialogOpen} onOpenChange={handleInstallDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('runtimeInstallTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('runtimeInstallDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          {installRecipe && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    installStage === 'completed'
                      ? 'text-green-600 border-green-200'
                      : installStage === 'failed'
                        ? 'text-red-600 border-red-200'
                        : 'text-blue-600 border-blue-200'
                  }
                >
                  {installStageLabel}
                </Badge>
                {installingRecipeId === installRecipe.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                {installRecipe.commandPreview}
              </pre>
              {installRecipe.postInstallHint && (
                <p className="text-xs text-muted-foreground">
                  {installRecipe.postInstallHint}
                </p>
              )}
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('runtimeInstallLogs')}</p>
                <div className="max-h-56 overflow-y-auto rounded bg-background p-3 font-mono text-xs">
                  {installLogs.length > 0 ? (
                    <pre className="whitespace-pre-wrap break-all">{installLogs.join('\n')}</pre>
                  ) : (
                    <p className="text-muted-foreground">{t('runtimeInstallWaitingLogs')}</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            {installingRecipeId === installRecipe?.id ? (
              <Button variant="outline" onClick={handleCancelInstall}>
                {t('runtimeInstallCancel')}
              </Button>
            ) : (
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            )}
            {installingRecipeId === installRecipe?.id ? (
              <Button disabled>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {installStageLabel}
              </Button>
            ) : installStage === 'completed' || installStage === 'failed' ? (
              <Button onClick={() => handleInstallDialogOpenChange(false)}>
                {t('runtimeInstallClose')}
              </Button>
            ) : (
              <Button onClick={handleConfirmInstall}>
                {t('installRuntime')}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
