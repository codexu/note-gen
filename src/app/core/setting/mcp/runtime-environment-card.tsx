'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, ChevronDown, TerminalSquare } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
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
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/runtime flex flex-col gap-2">
        <ItemGroup>
          <Item variant="outline" size="sm">
            <ItemMedia variant="icon"><TerminalSquare /></ItemMedia>
            <ItemContent>
              <ItemTitle>
                {t('runtimeEnvironment')}
                {hasAnyInspection ? (
                  <Badge variant="secondary">
                    {t('runtimeInstalledSummary', { installed: installedCount, total: RUNTIMES.length })}
                  </Badge>
                ) : null}
              </ItemTitle>
              {!hasAnyInspection ? <ItemDescription>{t('runtimeEnvironmentDesc')}</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCheckAll}
                disabled={checkingAll}
              >
                {checkingAll ? <Spinner data-icon="inline-start" /> : null}
                {hasAnyInspection ? t('recheckEnvironment') : t('checkEnvironment')}
              </Button>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isOpen ? t('hideRuntimeDetails') : t('showRuntimeDetails')}
                >
                  <ChevronDown className="transition-transform group-data-[state=open]/runtime:rotate-180" />
                </Button>
              </CollapsibleTrigger>
            </ItemActions>
          </Item>
        </ItemGroup>

        <CollapsibleContent>
          <div className="grid gap-2">
            {inspectionEntries.map(({ runtime, inspection }) => {
              const isInstalled = inspection?.checks.some((check) => check.installed) ?? false

              return (
                <div key={runtime.key} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{runtime.label}</p>
                      <Badge variant="outline">{runtime.command}</Badge>
                      {inspection ? (
                        <Badge variant={isInstalled ? 'secondary' : 'destructive'}>
                          {isInstalled ? t('runtimeInstalled') : t('runtimeMissing')}
                        </Badge>
                      ) : null}
                    </div>
                    {inspection ? (
                      <p className="text-xs text-muted-foreground">
                        {t('detectedLauncher')}: {inspection.launcher}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('runtimeNotChecked')}</p>
                    )}
                  </div>

                  {inspection ? (
                    <div className="flex flex-col gap-2">
                      {inspection.checks.map((check) => (
                        <div key={check.command} className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-col gap-1">
                              <p className="text-sm font-medium">{check.command}</p>
                              {check.resolvedPath ? (
                                <p className="break-all text-xs text-muted-foreground">{check.resolvedPath}</p>
                              ) : null}
                            </div>
                            <Badge variant={check.installed ? 'secondary' : 'destructive'}>
                              {check.installed ? t('runtimeInstalled') : t('runtimeMissing')}
                            </Badge>
                          </div>
                          {check.version ? (
                            <p className="text-xs text-muted-foreground">
                              {t('runtimeVersion')}: {check.version}
                            </p>
                          ) : null}
                        </div>
                      ))}

                      {!isInstalled && inspection.installRecipe ? (
                        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
                          <div className="flex items-start gap-2">
                            {inspection.installRecipe.manualOnly ? <AlertTriangle /> : <CheckCircle2 />}
                            <div className="flex flex-col gap-1">
                              <p className="text-sm font-medium">{inspection.installRecipe.title}</p>
                              <p className="text-xs text-muted-foreground">{t('runtimeCurrentUserScope')}</p>
                            </div>
                          </div>
                          <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                            {inspection.installRecipe.commandPreview}
                          </pre>
                          {inspection.installRecipe.postInstallHint ? (
                            <p className="text-xs text-muted-foreground">
                              {inspection.installRecipe.postInstallHint}
                            </p>
                          ) : null}
                          {inspection.installRecipe.manualOnly ? (
                            <p className="text-xs text-muted-foreground">{t('runtimeManualOnly')}</p>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleInstallClick(inspection.installRecipe!)}
                              disabled={installingRecipeId === inspection.installRecipe.id}
                            >
                              {installingRecipeId === inspection.installRecipe.id ? <Spinner data-icon="inline-start" /> : null}
                              {t('installRuntime')}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={installDialogOpen} onOpenChange={handleInstallDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('runtimeInstallTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('runtimeInstallDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          {installRecipe ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={installStage === 'failed' ? 'destructive' : installStage === 'completed' ? 'secondary' : 'outline'}
                >
                  {installStageLabel}
                </Badge>
                {installingRecipeId === installRecipe.id ? <Spinner /> : null}
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                {installRecipe.commandPreview}
              </pre>
              {installRecipe.postInstallHint ? (
                <p className="text-xs text-muted-foreground">
                  {installRecipe.postInstallHint}
                </p>
              ) : null}
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
          ) : null}
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
                <Spinner data-icon="inline-start" />
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
