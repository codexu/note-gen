'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleX, CloudDownload, FileText, FolderOpen, GitMerge, HardDrive, ListChecks, Minimize2, RefreshCcw, SkipForward, X,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toast } from '@/hooks/use-toast'
import { formatSyncDataError } from '@/lib/sync/remote-file'
import {
  platformSwitchImpact, type PlatformSwitchPlan, type SwitchConflict, type SwitchModule,
  type SwitchOperationProgress, type SwitchResolution, type SwitchStrategy,
} from '@/lib/sync/platform-switch-plan'
import { cn } from '@/lib/utils'
import useSettingStore from '@/stores/setting'
import {
  cancelPlatformSwitch, choosePlatformSwitchStrategy, confirmPlatformSwitch, dismissPlatformSwitch,
  editPlatformSwitchChoice, holdPlatformSwitchCompletion, resolvePlatformSwitchConflict,
  restorePlatformSwitchRecovery, retryPlatformSwitch, selectPlatformSwitchModule, skipPlatformSwitchError, usePlatformSwitchStore,
} from '@/stores/sync-platform-switch'
import { SYNC_PLATFORM_INFO, type SyncPlatform } from '@/types/sync'

const switchStages = ['inspect', 'choose', 'backup', 'sync', 'verify'] as const
const strategies = ['merge', 'local', 'remote'] as const
const strategyIcons = { merge: GitMerge, local: HardDrive, remote: CloudDownload }
const differenceTypes = [
  { key: 'same', label: 'sameCount', variant: 'success', color: 'bg-success' },
  { key: 'localOnly', label: 'localOnlyCount', variant: 'warning', color: 'bg-warning' },
  { key: 'remoteOnly', label: 'remoteOnlyCount', variant: 'info', color: 'bg-info' },
  { key: 'conflicts', label: 'conflictCount', variant: 'destructive', color: 'bg-destructive' },
] as const
type DifferenceCounts = Pick<PlatformSwitchPlan['modules'][number], typeof differenceTypes[number]['key']>

function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`
}

function useSwitchStage(state: ReturnType<typeof usePlatformSwitchStore.getState>) {
  const [highest, setHighest] = useState(0)
  const { platform, step, progress, failedStep, mutated } = state
  const phase = progress?.phase
  const activeStep = step === 'error' || step === 'cancelled' ? failedStep || (mutated ? 'reconciling' : 'local') : step
  const inspecting = ['local', 'currentRemote', 'nextRemote'].includes(step)
  const stage = activeStep === 'completed' ? 4 : ['review', 'confirm'].includes(activeStep) ? 1
    : phase === 'verify' || ['saving', 'starting'].includes(activeStep) ? 4
      : phase === 'apply' ? 3 : phase === 'backup' || phase === 'validate' || activeStep === 'preparing' ? 2 : mutated ? 3 : 0
  useEffect(() => {
    setHighest(previous => !platform || inspecting ? stage : Math.max(previous, stage))
  }, [platform, inspecting, stage])
  // Final platform activation reports preparing/starting/saving again after
  // verification. Keep this attempt's steps moving forward; a rescan resets it.
  return !platform || inspecting ? stage : Math.max(highest, stage)
}

function SwitchSteps({ active, failed, completed, nativeEngine }: { active: number; failed: boolean; completed: boolean; nativeEngine: boolean }) {
  const p = useTranslations('settings.sync.switchPlan')
  const stages = switchStages.map((stage, index) => ({ stage, index })).filter(item => !nativeEngine || item.stage !== 'backup')
  const activeStage = nativeEngine && active === 2 ? 3 : active
  return <nav aria-label={p('stepsLabel')}>
    <ol className={cn('grid gap-2', nativeEngine ? 'grid-cols-4' : 'grid-cols-5')}>
      {stages.map(({ stage, index }, position) => {
        const done = completed || index < activeStage
        const current = !completed && index === activeStage
        return <li key={stage} className="flex min-w-0 flex-col gap-2" aria-current={current ? 'step' : undefined}>
          <div className="flex items-center gap-2">
            <Badge variant={current && failed ? 'destructive' : done || current ? 'default' : 'outline'} className="size-6 shrink-0 p-0">
              {current && failed ? <AlertTriangle aria-hidden="true" /> : done ? <Check aria-hidden="true" /> : position + 1}
            </Badge>
            {position < stages.length - 1 && <Separator className="flex-1" />}
          </div>
          <span className={cn('break-words text-xs', current ? 'font-medium text-foreground' : 'text-muted-foreground')}>{p(`steps.${stage}`)}</span>
        </li>
      })}
    </ol>
  </nav>
}

function SwitchCurrentOperation({ progress, listing, activity }: {
  progress: SwitchOperationProgress | null
  listing: { path: string; files: number } | null
  activity: string
}) {
  const p = useTranslations('settings.sync.switchPlan')
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [progress?.phase, progress?.source])
  const directory = progress?.kind === 'directory' || progress?.phase === 'list' || (!progress && Boolean(listing))
  const paths = Array.from(new Set(progress?.activeFiles?.length ? progress.activeFiles : progress?.path ? [progress.path] : directory ? [listing?.path || ''] : [])).slice(0, 3)
  const total = progress?.total || 0
  const current = progress?.current ?? listing?.files ?? 0
  return <section className="flex min-w-0 flex-col gap-5" aria-label={p('currentTask')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2" role="status"><Spinner /><span>{activity}</span></div>
      <span className="text-xs tabular-nums text-muted-foreground">{p('phaseElapsed', { seconds: elapsed })}</span>
    </div>
    <div className="flex min-h-10 flex-col gap-2">
      {total > 0 && <Progress value={Math.min(100, current / total * 100)} aria-label={activity}
        aria-valuetext={p('counts', { current, total })} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{progress?.source ? p(`sources.${progress.source}`) : p('inspectTitle')}{progress?.module ? ` · ${p(`modules.${progress.module}`)}` : ''}</span>
        <span className="tabular-nums">{total > 0 ? p(progress?.kind === 'module' ? 'moduleProgress' : 'batchProgress', { current, total }) : directory ? p('discoveredFiles', { count: current }) : p('working')}</span>
      </div>
    </div>
    <section className="flex flex-col gap-2" aria-label={p(directory ? 'currentDirectory' : 'currentFiles')}>
      <p className="text-xs text-muted-foreground">{p(directory ? 'currentDirectory' : 'currentFiles')}</p>
      <ItemGroup className="min-h-40 gap-1">
        {paths.map(path => <Item key={path} variant="muted" size="sm">
          <ItemMedia variant="icon">{directory ? <FolderOpen /> : <FileText />}</ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="block truncate" title={path}>{path.split('/').filter(Boolean).pop() || p('rootDirectory')}</ItemTitle>
            <ItemDescription className="break-all" title={path}>{path || p('rootDirectory')}</ItemDescription>
          </ItemContent>
        </Item>)}
      </ItemGroup>
    </section>
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {progress?.cachedFiles !== undefined && <p>{p('incrementalReads', { cached: progress.cachedFiles, downloaded: progress.downloadedFiles || 0 })}</p>}
      {progress?.totalBytes !== undefined && <p>{p('processedSize', { current: ((progress.processedBytes || 0) / 1048576).toFixed(1), total: (progress.totalBytes / 1048576).toFixed(1) })}</p>}
    </div>
  </section>
}

function SwitchDifferenceBadges({ counts }: { counts: DifferenceCounts }) {
  const p = useTranslations('settings.sync.switchPlan')
  return <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={p('differences')}>
    {differenceTypes.map(({ key, label, variant }) => <li key={key} className="min-w-0 max-w-full">
      <Badge variant={counts[key] > 0 ? variant : 'secondary'} className="h-auto min-h-5 max-w-full whitespace-normal tabular-nums [overflow-wrap:anywhere]">{p(label, { count: counts[key] })}</Badge>
    </li>)}
  </ul>
}

function SwitchDataOverview({ plan, selected, remoteName }: { plan: PlatformSwitchPlan; selected: SwitchModule[]; remoteName: string }) {
  const p = useTranslations('settings.sync.switchPlan')
  const totals = plan.modules.filter(row => selected.includes(row.id)).reduce((sum, row) => ({
    same: sum.same + row.same, localOnly: sum.localOnly + row.localOnly,
    remoteOnly: sum.remoteOnly + row.remoteOnly, conflicts: sum.conflicts + row.conflicts,
  }), { same: 0, localOnly: 0, remoteOnly: 0, conflicts: 0 })
  const count = totals.same + totals.localOnly + totals.remoteOnly + totals.conflicts
  return <section className="flex flex-col gap-3" aria-label={p('dataOverview')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{p('dataOverview')}</h3>
      <span className="text-xs text-muted-foreground">{p('selectedModules', { count: selected.length })} · {p('sources.remote')} {p('fileCount', { count: plan.remoteFiles })}</span>
    </div>
    <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {differenceTypes.map(({ key, color }) => <span key={key} className={color} style={{ width: `${count ? totals[key] / count * 100 : 0}%` }} />)}
    </div>
    <SwitchDifferenceBadges counts={totals} />
    <h4 className="text-sm font-medium">{p('moduleDetails')}</h4>
    <Table aria-label={p('moduleDetails')}>
      <TableHeader><TableRow><TableHead>{p('module')}</TableHead><TableHead>{p('localSide')}</TableHead><TableHead>{remoteName}</TableHead><TableHead>{p('differences')}</TableHead></TableRow></TableHeader>
      <TableBody>{plan.modules.map(row => <TableRow key={row.id}>
        <TableCell><Field orientation="horizontal"><Checkbox id={`switch-module-${row.id}`} checked={selected.includes(row.id)} disabled={!plan.available.includes(row.id)} onCheckedChange={value => selectPlatformSwitchModule(row.id, value === true)} /><FieldLabel htmlFor={`switch-module-${row.id}`}>{p(`modules.${row.id}`)}</FieldLabel></Field></TableCell>
        <TableCell className="tabular-nums">{row.local}<p className="text-xs text-muted-foreground">{formatBytes(row.localBytes)}</p>{row.id === 'conversations' && <p className="text-xs text-muted-foreground">{p('messages', { count: row.localMessages })}</p>}</TableCell>
        <TableCell className="tabular-nums">{plan.unavailableModules.includes(row.id) ? p('unreadableSnapshot') : row.remote}<p className="text-xs text-muted-foreground">{formatBytes(row.remoteBytes)}</p>{row.id === 'conversations' && <p className="text-xs text-muted-foreground">{p('messages', { count: row.remoteMessages })}</p>}</TableCell>
        <TableCell className="min-w-48 whitespace-normal">{plan.unavailableModules.includes(row.id) ? <p className="text-xs text-muted-foreground">{p('cannotCompare')}</p> : <SwitchDifferenceBadges counts={row} />}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <p className="text-xs text-muted-foreground">{p('linkedModules')}</p>
    <p className="text-xs text-muted-foreground">{p('incrementalReads', { cached: plan.readSummary.cachedFiles, downloaded: plan.readSummary.downloadedFiles })}</p>
  </section>
}

function SwitchConflicts({ conflicts, resolutions, remoteName }: {
  conflicts: SwitchConflict[]; resolutions: Record<string, SwitchResolution>; remoteName: string
}) {
  const p = useTranslations('settings.sync.switchPlan')
  const [index, setIndex] = useState(0)
  const position = Math.min(index, Math.max(0, conflicts.length - 1))
  const conflict = conflicts[position]
  const resolved = conflicts.filter(item => resolutions[item.id]).length
  if (!conflict) return <Alert><Check /><AlertDescription>{p('noConflicts')}</AlertDescription></Alert>
  const resolveAll = (choice: SwitchResolution) => {
    for (const item of conflicts) resolvePlatformSwitchConflict(item.id, choice)
  }
  return <section className="flex flex-col gap-4" aria-label={p('conflictCount', { count: conflicts.length })}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{p('conflictCount', { count: conflicts.length })}</h3><Badge variant="secondary">{p('resolvedCount', { resolved, total: conflicts.length })}</Badge></div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm">{p('batchResolve')}<ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => resolveAll('local')}>{p('batchLocal')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resolveAll('remote')}>{p('batchRemote')}</DropdownMenuItem>
          {conflicts.every(item => item.allowBoth) && <DropdownMenuItem onSelect={() => resolveAll('both')}>{p('batchBoth')}</DropdownMenuItem>}
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">{p(`modules.${conflict.module}`)} · {p('conflictPosition', { current: position + 1, total: conflicts.length })}</span><p className="truncate font-medium" title={conflict.label}>{conflict.label}</p></div>
      <div className="flex shrink-0 gap-1">
        <Button variant="outline" size="icon-sm" disabled={position === 0} aria-label={p('previousConflict')} onClick={() => setIndex(position - 1)}><ChevronLeft /></Button>
        <Button variant="outline" size="icon-sm" disabled={position === conflicts.length - 1} aria-label={p('nextConflict')} onClick={() => setIndex(position + 1)}><ChevronRight /></Button>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {(['local', 'remote'] as const).map(side => <Card key={`${conflict.id}:${side}`} size="sm">
        <CardHeader><CardTitle>{side === 'local' ? p('localSide') : remoteName}</CardTitle></CardHeader>
        <CardContent><ScrollArea className="h-40"><pre className="whitespace-pre-wrap break-words pr-3 font-mono text-xs [overflow-wrap:anywhere]">{conflict[side]}</pre></ScrollArea></CardContent>
      </Card>)}
    </div>
    <FieldSet><FieldLegend variant="label">{p('choose')}</FieldLegend>
      <ToggleGroup type="single" variant="outline" value={resolutions[conflict.id] || ''} className="flex-wrap" onValueChange={value => { if (value) resolvePlatformSwitchConflict(conflict.id, value as SwitchResolution) }} aria-label={conflict.label}>
        <ToggleGroupItem value="local">{p('useLocalVersion')}</ToggleGroupItem><ToggleGroupItem value="remote">{p('useRemoteVersion')}</ToggleGroupItem>
        {conflict.allowBoth && <ToggleGroupItem value="both">{p('keepBoth')}</ToggleGroupItem>}
      </ToggleGroup>
    </FieldSet>
  </section>
}

export function PlatformSwitchProgress() {
  const t = useTranslations()
  const p = useTranslations('settings.sync.switchPlan')
  const state = usePlatformSwitchStore()
  const stage = useSwitchStage(state)
  const primary = useSettingStore(value => value.primaryBackupMethod)
  const { platform, step, plan, progress, error, strategy, selected, resolutions, mutated } = state
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState(primary)
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmation, setConfirmation] = useState<'cancel' | 'skip' | null>(null)
  const [skipAcknowledged, setSkipAcknowledged] = useState(false)
  const [draftStrategy, setDraftStrategy] = useState<SwitchStrategy | null>(null)
  const strategyHintId = useId()
  const acknowledgeId = useId()
  const skipId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const failureToast = useRef<ReturnType<typeof toast> | null>(null)
  useEffect(() => { void restorePlatformSwitchRecovery() }, [])
  useEffect(() => {
    setOpen(Boolean(platform))
    if (platform) setOrigin(useSettingStore.getState().primaryBackupMethod)
  }, [platform])
  useEffect(() => {
    // Retrying an intentionally skipped target starts a new attempt even when
    // the target ID is unchanged; its current primary is now the origin.
    if (platform && step === 'local') setOrigin(useSettingStore.getState().primaryBackupMethod)
  }, [platform, step])
  useEffect(() => {
    if (platform && ['review', 'confirm', 'error', 'cancelled'].includes(step)) setOpen(true)
    setSkipAcknowledged(false)
  }, [platform, step])
  useEffect(() => { setConfirmation(null) }, [platform])
  useEffect(() => { if (step === 'completed' || step === 'cancelled') setConfirmation(null) }, [step])
  useEffect(() => { setAcknowledged(false) }, [step, strategy, plan, resolutions])
  useEffect(() => { setDraftStrategy(strategy) }, [platform, step, strategy, plan])
  useEffect(() => {
    if (!open) return
    scroller.current?.querySelector('[data-slot="scroll-area-viewport"]')?.scrollTo({ top: 0 })
    heading.current?.focus()
  }, [step, open])

  const errorKeys: Record<string, string> = {
    SYNC_SWITCH_STALE: 'stale', SYNC_SWITCH_INTERRUPTED: 'interrupted', SYNC_SWITCH_EDITOR_BUSY: 'editorBusy',
    SYNC_SWITCH_CHAT_BUSY: 'chatBusy', SYNC_SWITCH_MISSING_REFERENCE: 'missingReference',
    SYNC_SWITCH_UNAVAILABLE_REMOTE_DATA: 'unavailableRemoteData', SYNC_SWITCH_CONDITIONAL_UNSUPPORTED: 'conditionalUnsupported',
    SYNC_SWITCH_RECOVERY_CHANGED: 'recoveryChanged',
    SYNC_SWITCH_CANCELLED: 'cancelledError',
  }
  const errorMessage = error && errorKeys[error] ? p(errorKeys[error]) : formatSyncDataError(error || p('failed'), p)
  useEffect(() => {
    if (!window.location.pathname.startsWith('/mobile')) return
    if (step === 'error' && !open) {
      const options = { title: p('failed'), description: errorMessage, variant: 'destructive' as const, duration: 5000, closeButton: true,
        action: { label: p('resumeReview'), onClick: () => setOpen(true) } }
      if (failureToast.current) failureToast.current.update(options)
      else failureToast.current = toast(options)
    } else { failureToast.current?.dismiss(); failureToast.current = null }
  }, [step, open, errorMessage, p])
  useEffect(() => () => { failureToast.current?.dismiss() }, [])
  useEffect(() => {
    if (step === 'completed' && open) holdPlatformSwitchCompletion()
  }, [step, open])
  useEffect(() => () => {
    if (usePlatformSwitchStore.getState().step === 'completed') void dismissPlatformSwitch()
  }, [])

  if (!platform) return null
  const platformName = (value: SyncPlatform) => value === 'local' ? t('settings.sync.local.title')
    : value === 'cloudFolder' ? t('settings.sync.cloudFolder.title') : SYNC_PLATFORM_INFO[value].name
  const name = platformName(state.recovered ? primary : platform)
  const originName = platformName(origin)
  const nativeEngine = platform === 'selfHosted'
  const choosing = step === 'review' || step === 'confirm'
  const stopped = step === 'error' || step === 'cancelled'
  const busy = !choosing && !stopped && step !== 'completed'
  const skipped = step === 'completed' && state.skipped
  const conflicts = plan?.conflicts.filter(item => selected.includes(item.module)) || []
  const unresolved = strategy === 'merge' ? conflicts.filter(item => !resolutions[item.id]).length : 0
  const unavailableRemote = plan?.unavailableModules.some(module => selected.includes(module)) || false
  const canChoose = draftStrategy !== null && selected.length > 0 && !(draftStrategy === 'remote' && unavailableRemote)
  const canConfirm = strategy !== null && acknowledged && selected.length > 0 && !unresolved && !(strategy === 'remote' && unavailableRemote)
  const activity = choosing ? p(step === 'review' ? 'reviewTitle' : 'confirmTitle')
    : state.cancelRequested ? p('cancelling') : skipped ? p('skipped') : step === 'completed' ? p('completed') : step === 'cancelled' ? p('cancelled') : step === 'error' ? p('failed')
      : progress ? p(`phases.${progress.phase}`) : t(`settings.sync.switchProgress.${step}`)
  const title = choosing ? p(step === 'review' ? 'reviewTitle' : 'confirmTitle')
    : skipped ? p('skipped') : step === 'cancelled' ? p('cancelled') : step === 'error' ? p('failed') : step === 'completed' ? p(state.recovered ? 'recoveryCompleted' : 'completed') : p(stage === 0 ? 'inspectTitle' : 'executeTitle')
  const impact = plan && strategy ? platformSwitchImpact(plan, strategy, selected, resolutions) : null
  const closeDetails = () => {
    if (step === 'completed') void dismissPlatformSwitch()
    else setOpen(false)
  }

  return <Dialog open={open} onOpenChange={next => { if (next) setOpen(true); else closeDetails() }}>
    <Item variant="outline" size="sm" className="mb-4" role="region" aria-label={p('panelTitle', { platform: name })}>
      <ItemMedia variant="icon">{step === 'error' || skipped ? <AlertTriangle /> : step === 'cancelled' ? <CircleX /> : step === 'completed' ? <Check /> : busy ? <Spinner /> : <ListChecks />}</ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle>{name} · {title}</ItemTitle><ItemDescription>{busy ? activity : p('currentPrimary', { platform: platformName(primary) })}</ItemDescription></ItemContent>
      <ItemActions>
        <Button ref={launcher} type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{p(choosing || stopped ? 'resumeReview' : 'viewProgress')}<ChevronRight data-icon="inline-end" /></Button>
        {step === 'completed' && <Button type="button" size="sm" onClick={() => void dismissPlatformSwitch()}>{p('done')}</Button>}
      </ItemActions>
    </Item>
    <DialogContent showCloseButton={false} className="flex h-[min(760px,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      onEscapeKeyDown={event => event.stopPropagation()}
      onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus() }}
      onCloseAutoFocus={event => { if (launcher.current) { event.preventDefault(); launcher.current.focus() } }}>
      <DialogHeader className="shrink-0 gap-4 px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle ref={heading} tabIndex={-1}>{p('flowTitle')}</DialogTitle>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{originName}</Badge><ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" /><Badge variant="secondary">{name}</Badge></div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={p(step === 'completed' ? 'done' : 'minimize')} title={p(step === 'completed' ? 'done' : 'minimize')} onClick={closeDetails}>{step === 'completed' ? <Check /> : <Minimize2 />}</Button>
        </div>
        <DialogDescription className="sr-only">{p('currentPrimary', { platform: platformName(primary) })}</DialogDescription>
        {skipped ? <Badge variant="secondary" className="self-start">{p('skipped')}</Badge> : <SwitchSteps active={stage} failed={step === 'error'} completed={step === 'completed'} nativeEngine={nativeEngine} />}
      </DialogHeader>
      <Separator />
      <ScrollArea ref={scroller} className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-6 px-5 py-5 sm:px-6">
          {busy && <SwitchCurrentOperation progress={progress} listing={state.listing} activity={activity} />}
          {choosing && unavailableRemote && <Alert variant="warning"><AlertTriangle /><AlertTitle>{p('unreadableSnapshot')}</AlertTitle><AlertDescription>{p('emptyLegacyFiles', { paths: plan?.emptyRemoteFiles.join('、') || '' })}</AlertDescription></Alert>}
          {step === 'review' && plan && !nativeEngine && <>
            <FieldSet><FieldLegend variant="label">{p('choose')}</FieldLegend>
              {draftStrategy === null && <Alert variant="warning" id={strategyHintId}><AlertTriangle /><AlertDescription>{p('strategyRequired')}</AlertDescription></Alert>}
              <ToggleGroup type="single" variant="outline" value={draftStrategy || ''} onValueChange={value => setDraftStrategy(strategies.find(strategy => strategy === value) || null)} className="grid w-full grid-cols-1 items-stretch gap-3 sm:grid-cols-3" aria-label={p('choose')} aria-describedby={draftStrategy === null ? strategyHintId : undefined}>
                {strategies.map(choice => {
                  const Icon = strategyIcons[choice]
                  return <ToggleGroupItem key={choice} value={choice} disabled={!selected.length || (choice === 'remote' && unavailableRemote)} className="h-auto min-w-0 flex-col items-start gap-3 whitespace-normal p-4 text-left">
                    <span className="flex w-full items-center justify-between gap-2"><Icon /><span className="flex-1">{p(`strategies.${choice}`)}</span>{draftStrategy === choice && <Check />}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{p(`descriptions.${choice}`, { platform: name })}</span>
                  </ToggleGroupItem>
                })}
              </ToggleGroup>
            </FieldSet>
            <SwitchDataOverview plan={plan} selected={selected} remoteName={name} />
          </>}
          {step === 'review' && nativeEngine && <Alert><ListChecks /><AlertTitle>{p('nativeMode')}</AlertTitle><AlertDescription>
            {state.review && <p className="whitespace-pre-wrap">{p('nativeSummary', {
              changes: state.review.pendingLocalChanges, commands: state.review.pendingCommands,
              currentRemote: state.review.currentRemoteObjects < 0 ? '?' : state.review.currentRemoteObjects,
              nextRemote: state.review.nextRemoteObjects < 0 ? '?' : state.review.nextRemoteObjects,
            })}</p>}
          </AlertDescription></Alert>}
          {step === 'confirm' && <>
            <section className="flex flex-col gap-3" aria-label={p('operationSummary')}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{p('operationSummary')}</h3><Badge variant="secondary">{nativeEngine ? p('nativeMode') : p(`strategies.${strategy || 'merge'}`)}</Badge></div>
              {impact && <div className="grid gap-3 sm:grid-cols-2">
                <Card size="sm"><CardHeader><CardTitle>{p('localSide')}</CardTitle></CardHeader><CardContent><CardDescription>{p('impact', { added: impact.localAdd, replaced: impact.localReplace, removed: impact.localRemove })}</CardDescription></CardContent></Card>
                <Card size="sm"><CardHeader><CardTitle>{name}</CardTitle></CardHeader><CardContent><CardDescription>{p('impact', { added: impact.remoteAdd, replaced: impact.remoteReplace, removed: impact.remoteRemove })}</CardDescription></CardContent></Card>
              </div>}
              <p className="text-xs text-muted-foreground">{selected.map(id => p(`modules.${id}`)).join(' · ')}</p>
            </section>
            {plan && strategy === 'merge' && conflicts.length > 0 && <SwitchConflicts key={plan.scanCachePath} conflicts={conflicts} resolutions={resolutions} remoteName={name} />}
          </>}
          {step === 'error' && <>
            <Alert variant="destructive"><AlertTriangle /><AlertTitle>{p('failed')}</AlertTitle><AlertDescription className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{errorMessage}</AlertDescription></Alert>
            <p className="text-sm text-muted-foreground">{p(mutated ? 'partialFailure' : 'failureBeforeWrite')}</p>
          </>}
          {step === 'cancelled' && <Alert><CircleX /><AlertTitle>{p('cancelled')}</AlertTitle><AlertDescription>{p(mutated ? 'cancelledPartialHint' : 'cancelledHint')}</AlertDescription></Alert>}
          {skipped && <Alert variant="warning"><AlertTriangle /><AlertTitle>{p('skipped')}</AlertTitle><AlertDescription className="flex flex-col gap-2"><p>{p('skippedHint', { platform: name })}</p>{error && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{errorMessage}</p>}</AlertDescription></Alert>}
          {step === 'completed' && !skipped && <Empty><EmptyHeader><EmptyMedia variant="icon"><Check /></EmptyMedia><EmptyTitle>{p(state.recovered ? 'recoveryCompleted' : 'completed')}</EmptyTitle></EmptyHeader></Empty>}
        </div>
      </ScrollArea>
      <Separator />
      <footer className="flex shrink-0 flex-col gap-3 bg-muted/30 px-5 py-4 sm:px-6">
        {step === 'confirm' && <FieldGroup>
          <FieldLabel htmlFor={acknowledgeId} tone={canConfirm ? 'success' : 'warning'} className={cn('has-focus-visible:ring-2 has-focus-visible:ring-ring', unresolved > 0 ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <Field orientation="horizontal" data-disabled={unresolved > 0} className="min-h-14 gap-3">
              <Checkbox id={acknowledgeId} className="size-5" checked={acknowledged} disabled={unresolved > 0}
                aria-labelledby={`${acknowledgeId}-label`} aria-describedby={unresolved > 0 ? `${acknowledgeId}-hint` : undefined}
                onCheckedChange={value => setAcknowledged(value === true)} />
              <FieldContent>
                <FieldTitle id={`${acknowledgeId}-label`}>{p('acknowledge')}</FieldTitle>
                {unresolved > 0 && <FieldDescription id={`${acknowledgeId}-hint`}>{p('unresolved', { count: unresolved })}</FieldDescription>}
              </FieldContent>
            </Field>
          </FieldLabel>
        </FieldGroup>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground" role="status">{p('currentPrimary', { platform: platformName(primary) })}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {step !== 'completed' && step !== 'cancelled' && <Button type="button" variant="outline" disabled={state.cancelRequested} onClick={() => { if (mutated) setConfirmation('cancel'); else void cancelPlatformSwitch() }}>{state.cancelRequested ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}{p(state.cancelRequested ? 'cancelling' : 'cancelSwitch')}</Button>}
            {step === 'confirm' && <Button type="button" variant="outline" onClick={editPlatformSwitchChoice}><ChevronLeft data-icon="inline-start" />{p('back')}</Button>}
            {step === 'review' && <Button type="button" disabled={nativeEngine ? !selected.length : !plan || !canChoose} aria-describedby={!nativeEngine && draftStrategy === null ? strategyHintId : undefined} onClick={() => {
              if (nativeEngine) choosePlatformSwitchStrategy('merge')
              else if (draftStrategy) choosePlatformSwitchStrategy(draftStrategy)
            }}>{p('continue')}<ArrowRight data-icon="inline-end" /></Button>}
            {step === 'confirm' && <Button type="button" disabled={!canConfirm} aria-describedby={unresolved > 0 ? `${acknowledgeId}-hint` : undefined} onClick={confirmPlatformSwitch}>{p('confirmExecute')}<ArrowRight data-icon="inline-end" /></Button>}
            {stopped && <Button type="button" variant="outline" onClick={() => setConfirmation('skip')}><SkipForward data-icon="inline-start" />{p(step === 'cancelled' ? 'confirmSkip' : 'skipError')}</Button>}
            {(stopped || skipped) && <Button type="button" onClick={() => void retryPlatformSwitch()}><RefreshCcw data-icon="inline-start" />{p(skipped ? 'verifySkipped' : 'rescanRetry')}</Button>}
            {step === 'cancelled' && !mutated && <Button type="button" variant="outline" onClick={() => void dismissPlatformSwitch()}>{p('done')}</Button>}
            {step === 'completed' && <Button type="button" onClick={() => void dismissPlatformSwitch()}><Check data-icon="inline-start" />{p('done')}</Button>}
            {(busy || stopped && mutated) && <Button type="button" variant="outline" onClick={() => setOpen(false)}><Minimize2 data-icon="inline-start" />{p('minimize')}</Button>}
          </div>
        </div>
      </footer>
    </DialogContent>
    <AlertDialog open={confirmation !== null} onOpenChange={next => { if (!next) { setConfirmation(null); setSkipAcknowledged(false) } }}>
      <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); heading.current?.focus() }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{p(confirmation === 'skip' ? 'skipTitle' : 'cancelTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation === 'skip' ? p('skipDescription', { platform: name }) : p('cancelDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmation === 'skip' && <Field orientation="horizontal"><Checkbox id={skipId} checked={skipAcknowledged} onCheckedChange={value => setSkipAcknowledged(value === true)} /><FieldLabel htmlFor={skipId}>{p('skipAcknowledge')}</FieldLabel></Field>}
        <AlertDialogFooter>
          <AlertDialogCancel>{p(confirmation === 'skip' ? 'cancel' : 'keepSwitching')}</AlertDialogCancel>
          <AlertDialogAction disabled={confirmation === 'skip' && (!skipAcknowledged || !stopped)} onClick={() => { if (confirmation === 'skip') void skipPlatformSwitchError(); else void cancelPlatformSwitch() }}>{p(confirmation === 'skip' ? 'confirmSkip' : 'confirmCancel')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Dialog>
}
