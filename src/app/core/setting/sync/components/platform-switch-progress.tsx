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
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SyncContentComparison } from '@/components/sync-content-comparison'
import { toast } from '@/hooks/use-toast'
import { formatSyncDataError } from '@/lib/sync/remote-file'
import {
  platformSwitchImpact, type PlatformSwitchPlan, type SwitchConflict, type SwitchModule,
  type SwitchOperationProgress, type SwitchResolution, type SwitchStrategy,
} from '@/lib/sync/platform-switch-plan'
import { cn } from '@/lib/utils'
import type { SelfHostedSwitchPreview } from '@/lib/self-hosted-sync/switch-preview'
import useSettingStore from '@/stores/setting'
import {
  cancelPlatformSwitch, choosePlatformSwitchStrategy, confirmPlatformSwitch, dismissPlatformSwitch,
  editPlatformSwitchChoice, holdPlatformSwitchCompletion, resolvePlatformSwitchConflict,
  restorePlatformSwitchRecovery, retryPlatformSwitch, selectPlatformSwitchModule, setPlatformSwitchRecoveryVisible, skipPlatformSwitchError, usePlatformSwitchStore,
  continueSelfHostedSwitchWithoutSettings, recoverSelfHostedSwitchBackup,
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
    : phase === 'verify' || phase === 'start' || ['saving', 'starting'].includes(activeStep) ? 4
      : phase === 'apply' ? 3 : phase === 'backup' || phase === 'validate' || activeStep === 'preparing' ? 2 : mutated ? 3 : 0
  useEffect(() => {
    setHighest(previous => !platform || inspecting ? stage : Math.max(previous, stage))
  }, [platform, inspecting, stage])
  // Final platform activation reports preparing/starting/saving again after
  // verification. Keep this attempt's steps moving forward; a rescan resets it.
  return !platform || inspecting ? stage : Math.max(highest, stage)
}

function SwitchSteps({ active, failed, completed }: { active: number; failed: boolean; completed: boolean }) {
  const p = useTranslations('settings.sync.switchPlan')
  const stages = switchStages.map((stage, index) => ({ stage, index }))
  const activeStage = active
  return <nav aria-label={p('stepsLabel')}>
    <ol className="grid grid-cols-5 gap-2">
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
  }, [progress?.phase, progress?.source, progress?.startupTask])
  const directory = progress?.kind === 'directory' || progress?.phase === 'list' || (!progress && Boolean(listing))
  const items = progress?.kind === 'item'
  const itemLabel = items ? 'currentItem' : directory ? 'currentDirectory' : 'currentFiles'
  const paths = Array.from(new Set(progress?.activeFiles?.length ? progress.activeFiles : progress?.path ? [progress.path] : directory ? [listing?.path || ''] : [])).slice(0, 3)
  const total = progress?.total || 0
  const current = progress?.current ?? listing?.files ?? 0
  const counter = total > 0 ? p(items ? 'itemProgress' : progress?.kind === 'module' ? 'moduleProgress' : 'batchProgress', { current, total })
    : items ? p('processedItems', { count: current }) : directory ? p('discoveredFiles', { count: current }) : p('working')
  return <section className="flex min-w-0 flex-col gap-5" aria-label={p('currentTask')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2" role="status"><Spinner /><span>{activity}</span></div>
      <span className="text-xs tabular-nums text-muted-foreground">{p('phaseElapsed', { seconds: elapsed })}</span>
    </div>
    <div className="flex min-h-10 flex-col gap-2">
      {total > 0 && <Progress value={Math.min(100, current / total * 100)} aria-label={activity}
        aria-valuetext={items ? counter : p('counts', { current, total })} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{progress?.source ? p(`sources.${progress.source}`) : p(progress?.phase === 'start' ? 'phases.start' : 'inspectTitle')}{progress?.module ? ` · ${p(`modules.${progress.module}`)}` : ''}</span>
        <span className="tabular-nums">{counter}</span>
      </div>
      {progress?.documentProgress && <p className="text-xs tabular-nums text-muted-foreground">{p('documentProgress', progress.documentProgress)}</p>}
    </div>
    {paths.length > 0 && <section className="flex flex-col gap-2" aria-label={p(itemLabel)}>
      <p className="text-xs text-muted-foreground">{p(itemLabel)}</p>
      <ItemGroup className="min-h-40 gap-1">
        {paths.map(path => <Item key={path} variant="muted" size="sm">
          <ItemMedia variant="icon">{directory ? <FolderOpen /> : <FileText />}</ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="block truncate" title={path}>{path.split('/').filter(Boolean).pop() || p('rootDirectory')}</ItemTitle>
            <ItemDescription className="break-all" title={path}>{path || p('rootDirectory')}</ItemDescription>
          </ItemContent>
        </Item>)}
      </ItemGroup>
    </section>}
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
    <div className="flex min-w-0 flex-col gap-3 md:hidden">
      {plan.modules.map(row => <Card key={row.id} size="sm" className="min-w-0">
        <CardHeader><Field orientation="horizontal"><Checkbox id={`switch-module-mobile-${row.id}`} checked={selected.includes(row.id)} disabled={!plan.available.includes(row.id)} onCheckedChange={value => selectPlatformSwitchModule(row.id, value === true)} /><FieldLabel htmlFor={`switch-module-mobile-${row.id}`}>{p(`modules.${row.id}`)}</FieldLabel></Field></CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <dl className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0"><dt className="break-words text-xs text-muted-foreground">{p('localSide')}</dt><dd className="tabular-nums">{row.local} · {formatBytes(row.localBytes)}</dd>{row.id === 'conversations' && <dd className="text-xs text-muted-foreground">{p('messages', { count: row.localMessages })}</dd>}</div>
            <div className="min-w-0"><dt className="break-words text-xs text-muted-foreground">{remoteName}</dt><dd className="tabular-nums">{plan.unavailableModules.includes(row.id) ? p('unreadableSnapshot') : `${row.remote} · ${formatBytes(row.remoteBytes)}`}</dd>{row.id === 'conversations' && <dd className="text-xs text-muted-foreground">{p('messages', { count: row.remoteMessages })}</dd>}</div>
          </dl>
          {plan.unavailableModules.includes(row.id) ? <p className="text-xs text-muted-foreground">{p('cannotCompare')}</p> : <SwitchDifferenceBadges counts={row} />}
        </CardContent>
      </Card>)}
    </div>
    <div className="hidden min-w-0 md:block"><Table aria-label={p('moduleDetails')}>
      <TableHeader><TableRow><TableHead>{p('module')}</TableHead><TableHead>{p('localSide')}</TableHead><TableHead>{remoteName}</TableHead><TableHead>{p('differences')}</TableHead></TableRow></TableHeader>
      <TableBody>{plan.modules.map(row => <TableRow key={row.id}>
        <TableCell><Field orientation="horizontal"><Checkbox id={`switch-module-${row.id}`} checked={selected.includes(row.id)} disabled={!plan.available.includes(row.id)} onCheckedChange={value => selectPlatformSwitchModule(row.id, value === true)} /><FieldLabel htmlFor={`switch-module-${row.id}`}>{p(`modules.${row.id}`)}</FieldLabel></Field></TableCell>
        <TableCell className="tabular-nums">{row.local}<p className="text-xs text-muted-foreground">{formatBytes(row.localBytes)}</p>{row.id === 'conversations' && <p className="text-xs text-muted-foreground">{p('messages', { count: row.localMessages })}</p>}</TableCell>
        <TableCell className="tabular-nums">{plan.unavailableModules.includes(row.id) ? p('unreadableSnapshot') : row.remote}<p className="text-xs text-muted-foreground">{formatBytes(row.remoteBytes)}</p>{row.id === 'conversations' && <p className="text-xs text-muted-foreground">{p('messages', { count: row.remoteMessages })}</p>}</TableCell>
        <TableCell className="min-w-48 whitespace-normal">{plan.unavailableModules.includes(row.id) ? <p className="text-xs text-muted-foreground">{p('cannotCompare')}</p> : <SwitchDifferenceBadges counts={row} />}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
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
    <SyncContentComparison key={conflict.id} localContent={conflict.local} remoteContent={conflict.remote} localLabel={p('localSide')} remoteLabel={remoteName} />
    <FieldSet><FieldLegend variant="label">{p('choose')}</FieldLegend>
      <ToggleGroup type="single" variant="outline" value={resolutions[conflict.id] || ''} className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3" onValueChange={value => { if (value) resolvePlatformSwitchConflict(conflict.id, value as SwitchResolution) }} aria-label={conflict.label}>
        <ToggleGroupItem className="h-auto min-h-10 min-w-0 whitespace-normal" value="local">{p('useLocalVersion')}</ToggleGroupItem><ToggleGroupItem className="h-auto min-h-10 min-w-0 whitespace-normal" value="remote">{p('useRemoteVersion')}</ToggleGroupItem>
        {conflict.allowBoth && <ToggleGroupItem className="h-auto min-h-10 min-w-0 whitespace-normal" value="both">{p('keepBoth')}</ToggleGroupItem>}
      </ToggleGroup>
    </FieldSet>
  </section>
}

function selfHostedSwitchImpact(preview: SelfHostedSwitchPreview, strategy: SwitchStrategy, selected: SwitchModule[]) {
  if (strategy === 'merge') return null
  const counts = preview.modules.filter(row => selected.includes(row.id)).reduce((sum, row) => ({
    localOnly: sum.localOnly + row.localOnly, remoteOnly: sum.remoteOnly + row.remoteOnly,
    changed: sum.changed + row.changed, deleted: sum.deleted + row.deleted,
  }), { localOnly: 0, remoteOnly: 0, changed: 0, deleted: 0 })
  return {
    localAdd: strategy === 'remote' ? counts.remoteOnly : 0,
    localReplace: strategy === 'remote' ? counts.changed : 0,
    localRemove: strategy === 'remote' ? counts.localOnly + counts.deleted : 0,
    remoteAdd: strategy === 'local' ? counts.localOnly + counts.deleted : 0,
    remoteReplace: strategy === 'local' ? counts.changed : 0,
    remoteRemove: strategy === 'local' ? counts.remoteOnly : 0,
  }
}

function SelfHostedSwitchOverview({ preview, strategy }: { preview: SelfHostedSwitchPreview; strategy: SwitchStrategy | null }) {
  const p = useTranslations('settings.sync.switchPlan')
  const differences = (row: SelfHostedSwitchPreview['modules'][number]) => <div className="flex min-w-0 flex-wrap gap-1.5 [&>[data-slot=badge]]:h-auto [&>[data-slot=badge]]:max-w-full [&>[data-slot=badge]]:whitespace-normal [&>[data-slot=badge]]:[overflow-wrap:anywhere]">
    <Badge variant="secondary">{p('sameCount', { count: row.same })}</Badge>
    <Badge variant={row.localOnly ? 'warning' : 'secondary'}>{p('localOnlyCount', { count: row.localOnly })}</Badge>
    <Badge variant={row.remoteOnly ? 'info' : 'secondary'}>{p('remoteOnlyCount', { count: row.remoteOnly })}</Badge>
    <Badge variant={row.changed ? 'warning' : 'secondary'}>{p('nativeChangedCount', { count: row.changed })}</Badge>
    <Badge variant={row.deleted ? 'destructive' : 'secondary'}>{p('nativeDeletedCount', { count: row.deleted })}</Badge>
  </div>
  return <section className="flex min-w-0 flex-col gap-4" aria-label={p('comparison')}>
    <Alert><ListChecks /><AlertTitle>{p('nativeReviewAction')}</AlertTitle><AlertDescription className="flex flex-col gap-2">
      <p className="break-all">{preview.serverUrl}</p>
      <p>{p('nativePreviewHint')}</p>
      <p>{p('nativeEngine')}</p>
    </AlertDescription></Alert>
    {preview.settingsPaused && <Alert variant="warning"><AlertTriangle /><AlertDescription>{p('nativeSettingsPaused')}</AlertDescription></Alert>}
    <div className="flex min-w-0 flex-col gap-3 md:hidden">
      {preview.modules.map(row => <Card key={row.id} size="sm" className="min-w-0">
        <CardHeader><CardTitle>{p(`modules.${row.id}`)}</CardTitle></CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{p('localSide')}</dt><dd className="tabular-nums">{row.local}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{p('sources.remote')}</dt><dd className="tabular-nums">{row.remote}</dd></div>
          </dl>
          {differences(row)}
        </CardContent>
      </Card>)}
    </div>
    <div className="hidden min-w-0 md:block"><Table aria-label={p('moduleDetails')}>
      <TableHeader><TableRow><TableHead>{p('module')}</TableHead><TableHead>{p('localSide')}</TableHead><TableHead>{p('sources.remote')}</TableHead><TableHead>{p('differences')}</TableHead></TableRow></TableHeader>
      <TableBody>{preview.modules.map(row => <TableRow key={row.id}>
        <TableCell>{p(`modules.${row.id}`)}</TableCell>
        <TableCell className="tabular-nums">{row.local}</TableCell><TableCell className="tabular-nums">{row.remote}</TableCell>
        <TableCell className="min-w-48 whitespace-normal">{differences(row)}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
    {preview.details.length > 0 && <section className="flex flex-col gap-2" aria-label={p('viewDifference')}>
      <h3 className="text-sm font-medium">{p('viewDifference')}</h3>
      <p className="text-xs text-muted-foreground">{p('nativeDetailLimit', { shown: preview.details.length, total: preview.differenceCount })}</p>
      <ItemGroup className="gap-1">{preview.details.map((item, index) => <Item key={`${item.module}:${index}`} variant="muted" size="sm">
        <ItemContent className="min-w-0"><ItemTitle className="block truncate" title={item.label}>{item.module === 'settings' ? p('modules.settings') : item.label}</ItemTitle><ItemDescription>{p(`modules.${item.module}`)}</ItemDescription></ItemContent>
        <ItemActions><Badge variant={item.difference === 'deleted' ? 'destructive' : 'secondary'}>{p(`nativeDifferences.${item.difference}`)}</Badge></ItemActions>
      </Item>)}</ItemGroup>
    </section>}
    <Alert variant="warning"><AlertTriangle /><AlertTitle>{p('nativeHandlingTitle')}</AlertTitle><AlertDescription className="flex flex-col gap-2">
      {strategy === 'merge' && <><p>{p('nativeHandlingFiles')}</p><p>{p('nativeHandlingPersonal')}</p><p>{p('nativeHandlingDeletions')}</p></>}
      {strategy && strategy !== 'merge' && <p>{p(`nativeDescriptions.${strategy}`)}</p>}
      <p>{p('nativeBackupHint')}</p>
    </AlertDescription></Alert>
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
  const [confirmation, setConfirmation] = useState<'cancel' | 'skip' | 'restore' | null>(null)
  const [skipAcknowledged, setSkipAcknowledged] = useState(false)
  const [draftStrategy, setDraftStrategy] = useState<SwitchStrategy | null>(null)
  const hideCancelled = state.cancelledHidden && (state.cancelRequested || step === 'cancelled')
  const strategyHintId = useId()
  const acknowledgeId = useId()
  const skipId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const failureToast = useRef<ReturnType<typeof toast> | null>(null)
  useEffect(() => { void restorePlatformSwitchRecovery() }, [])
  useEffect(() => {
    setOpen(Boolean(platform) && !hideCancelled)
    if (platform) setOrigin(useSettingStore.getState().primaryBackupMethod)
  }, [platform, hideCancelled])
  useEffect(() => {
    // Retrying an intentionally skipped target starts a new attempt even when
    // the target ID is unchanged; its current primary is now the origin.
    if (platform && step === 'local') setOrigin(useSettingStore.getState().primaryBackupMethod)
  }, [platform, step])
  useEffect(() => {
    if (platform && !hideCancelled && (state.recoveringSelfHostedBackup || ['review', 'confirm', 'error'].includes(step))) setOpen(true)
    setSkipAcknowledged(false)
  }, [platform, step, state.recoveringSelfHostedBackup, hideCancelled])
  useEffect(() => { setConfirmation(null) }, [platform])
  useEffect(() => { if (step === 'completed' || step === 'cancelled') setConfirmation(null) }, [step])
  useEffect(() => { setAcknowledged(false) }, [step, strategy, plan, resolutions])
  useEffect(() => { setDraftStrategy(strategy) }, [platform, step, strategy, plan])
  useEffect(() => {
    if (!open) return
    scroller.current?.scrollTo({ top: 0 })
    heading.current?.focus()
  }, [step, open])

  const errorKeys: Record<string, string> = {
    SYNC_SWITCH_STALE: 'stale', SYNC_SWITCH_INTERRUPTED: 'interrupted', SYNC_SWITCH_EDITOR_BUSY: 'editorBusy',
    SYNC_SWITCH_CHAT_BUSY: 'chatBusy', SYNC_SWITCH_MISSING_REFERENCE: 'missingReference',
    SYNC_SWITCH_UNAVAILABLE_REMOTE_DATA: 'unavailableRemoteData', SYNC_SWITCH_CONDITIONAL_UNSUPPORTED: 'conditionalUnsupported',
    SYNC_SWITCH_RECOVERY_CHANGED: 'recoveryChanged',
    SYNC_SWITCH_CANCELLED: 'cancelledError',
    SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED: 'nativeConnectionRequired',
    SELF_HOSTED_PREVIEW_INSTANCE_CHANGED: 'nativeInstanceChanged',
    SELF_HOSTED_PREVIEW_LIBRARY_REQUIRED: 'nativeLibraryRequired',
    SELF_HOSTED_PREVIEW_KEY_REQUIRED: 'nativeKeyRequired',
    SELF_HOSTED_PREVIEW_DECRYPTION_FAILED: 'nativeDecryptionFailed',
    SELF_HOSTED_PREVIEW_SETTING_DECRYPTION_FAILED: 'nativeDecryptionFailed',
    SELF_HOSTED_BOOTSTRAP_CAPACITY_EXCEEDED: 'nativeSnapshotCapacity',
    SELF_HOSTED_PREVIEW_CONTENT_REQUIRED: 'nativeContentRequired',
    SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY: 'nativeDuplicateIdentity',
    SELF_HOSTED_SWITCH_DEPENDENCY_REQUIRED: 'nativeDependencyRequired',
    SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING: 'nativeRemoteDependencyMissing',
    SELF_HOSTED_SWITCH_WRITE_REQUIRED: 'nativeWriteRequired',
    SELF_HOSTED_SWITCH_RESULT_MISMATCH: 'nativeResultMismatch',
    SELF_HOSTED_SWITCH_COMMAND_REJECTED: 'nativeResultMismatch',
    SELF_HOSTED_SWITCH_PATH_MOVES_PENDING: 'nativePathMovesPending',
    SELF_HOSTED_BACKUP_INVALID: 'nativeBackupInvalid',
    SELF_HOSTED_BACKUP_LEGACY: 'nativeBackupLegacy',
    SELF_HOSTED_BACKUP_FILE_JOURNAL_PENDING: 'nativeBackupFileJournalPending',
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

  if (!platform || hideCancelled) return null
  const platformName = (value: SyncPlatform) => value === 'local' ? t('settings.sync.local.title')
    : value === 'cloudFolder' ? t('settings.sync.cloudFolder.title')
      : value === 'selfHosted' ? t('settings.sync.selfHosted.title') : SYNC_PLATFORM_INFO[value].name
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
      : progress?.startupTask ? p(`startupTasks.${progress.startupTask}`) : progress ? p(`phases.${progress.phase}`) : t(`settings.sync.switchProgress.${step}`)
  const title = choosing ? p(step === 'review' ? 'reviewTitle' : 'confirmTitle')
    : skipped ? p('skipped') : step === 'cancelled' ? p('cancelled') : step === 'error' ? p('failed') : step === 'completed' ? p(state.recovered ? 'recoveryCompleted' : 'completed') : p(stage === 0 ? 'inspectTitle' : 'executeTitle')
  const impact = strategy ? nativeEngine && state.review?.selfHostedPreview
    ? selfHostedSwitchImpact(state.review.selfHostedPreview, strategy, selected)
    : plan ? platformSwitchImpact(plan, strategy, selected, resolutions) : null : null
  const closeDetails = () => {
    if (state.recoveringSelfHostedBackup) return
    if (step === 'completed') void dismissPlatformSwitch()
    else if (step === 'cancelled') setPlatformSwitchRecoveryVisible(false)
    else setOpen(false)
  }

  return <Dialog open={open} onOpenChange={next => { if (next) setOpen(true); else closeDetails() }}>
    <Item variant="outline" size="sm" className="mb-4 min-w-0 flex-wrap" role="region" aria-label={p('panelTitle', { platform: name })}>
      <ItemMedia variant="icon">{step === 'error' || skipped ? <AlertTriangle /> : step === 'cancelled' ? <CircleX /> : step === 'completed' ? <Check /> : busy ? <Spinner /> : <ListChecks />}</ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle>{name} · {title}</ItemTitle><ItemDescription>{busy ? activity : p('currentPrimary', { platform: platformName(primary) })}</ItemDescription></ItemContent>
      <ItemActions className="flex-wrap">
        <Button ref={launcher} type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{p(choosing || stopped ? 'resumeReview' : 'viewProgress')}<ChevronRight data-icon="inline-end" /></Button>
        {step === 'completed' && <Button type="button" size="sm" onClick={() => void dismissPlatformSwitch()}>{p('done')}</Button>}
      </ItemActions>
    </Item>
    <DialogContent showCloseButton={false} className="flex h-[min(760px,calc(100dvh-2rem))] min-h-0 min-w-0 flex-col gap-0 overflow-hidden p-0 max-sm:top-[env(safe-area-inset-top)] max-sm:left-0 max-sm:h-[calc(var(--mobile-viewport-height,100dvh)-env(safe-area-inset-top))] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:min-w-0 sm:max-w-4xl"
      onEscapeKeyDown={event => { event.stopPropagation(); if (state.recoveringSelfHostedBackup) event.preventDefault() }}
      onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus() }}
      onCloseAutoFocus={event => { if (launcher.current) { event.preventDefault(); launcher.current.focus() } }}>
      <DialogHeader className="shrink-0 gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle ref={heading} tabIndex={-1}>{p('flowTitle')}</DialogTitle>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{originName}</Badge><ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" /><Badge variant="secondary">{name}</Badge></div>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" disabled={state.recoveringSelfHostedBackup} aria-label={p(step === 'completed' ? 'done' : 'minimize')} title={p(step === 'completed' ? 'done' : 'minimize')} onClick={closeDetails}>{step === 'completed' ? <Check /> : <Minimize2 />}</Button>
        </div>
        <DialogDescription className="sr-only">{p('currentPrimary', { platform: platformName(primary) })}</DialogDescription>
        {skipped ? <Badge variant="secondary" className="self-start">{p('skipped')}</Badge> : <SwitchSteps active={stage} failed={step === 'error'} completed={step === 'completed'} />}
      </DialogHeader>
      <Separator />
      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-w-0 flex-col gap-5 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5">
          {busy && <SwitchCurrentOperation progress={progress} listing={['local', 'currentRemote', 'nextRemote'].includes(step) || progress?.phase === 'list' ? state.listing : null} activity={activity} />}
          {choosing && unavailableRemote && <Alert variant="warning"><AlertTriangle /><AlertTitle>{p('unreadableSnapshot')}</AlertTitle><AlertDescription>{p('emptyLegacyFiles', { paths: plan?.emptyRemoteFiles.join('、') || '' })}</AlertDescription></Alert>}
          {step === 'review' && (plan || state.review?.selfHostedPreview) && <>
            <FieldSet><FieldLegend variant="label">{p('choose')}</FieldLegend>
              {draftStrategy === null && <Alert variant="warning" id={strategyHintId}><AlertTriangle /><AlertDescription>{p('strategyRequired')}</AlertDescription></Alert>}
              <ToggleGroup type="single" variant="outline" value={draftStrategy || ''} onValueChange={value => setDraftStrategy(strategies.find(strategy => strategy === value) || null)} className="grid w-full grid-cols-1 items-stretch gap-3 sm:grid-cols-3" aria-label={p('choose')} aria-describedby={draftStrategy === null ? strategyHintId : undefined}>
                {strategies.map(choice => {
                  const Icon = strategyIcons[choice]
                  return <ToggleGroupItem key={choice} value={choice} disabled={!selected.length || (choice === 'remote' && unavailableRemote)} className="h-auto min-w-0 flex-col items-start gap-3 whitespace-normal p-4 text-left">
                    <span className="flex w-full items-center justify-between gap-2"><Icon /><span className="flex-1">{p(`strategies.${choice}`)}</span>{draftStrategy === choice && <Check />}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{p(`${nativeEngine ? 'nativeDescriptions' : 'descriptions'}.${choice}`, { platform: name })}</span>
                  </ToggleGroupItem>
                })}
              </ToggleGroup>
            </FieldSet>
            {plan && !nativeEngine && <SwitchDataOverview plan={plan} selected={selected} remoteName={name} />}
          </>}
          {choosing && nativeEngine && state.review?.selfHostedPreview && <SelfHostedSwitchOverview preview={state.review.selfHostedPreview} strategy={step === 'review' ? draftStrategy : strategy} />}
          {step === 'confirm' && <>
            <section className="flex flex-col gap-3" aria-label={p('operationSummary')}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{p('operationSummary')}</h3><Badge variant="secondary">{p(`strategies.${strategy || 'merge'}`)}</Badge></div>
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
            {error === 'SELF_HOSTED_PREVIEW_SETTING_DECRYPTION_FAILED' && !mutated && <Alert>
              <ListChecks /><AlertDescription>{p('nativeSkipSettingsHint')}</AlertDescription>
            </Alert>}
          </>}
          {step === 'cancelled' && <Alert><CircleX /><AlertTitle>{p('cancelled')}</AlertTitle><AlertDescription>{p(mutated ? 'cancelledPartialHint' : 'cancelledHint')}</AlertDescription></Alert>}
          {skipped && <Alert variant="warning"><AlertTriangle /><AlertTitle>{p('skipped')}</AlertTitle><AlertDescription className="flex flex-col gap-2"><p>{p('skippedHint', { platform: name })}</p>{error && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{errorMessage}</p>}</AlertDescription></Alert>}
          {step === 'completed' && !skipped && <Empty><EmptyHeader><EmptyMedia variant="icon"><Check /></EmptyMedia><EmptyTitle>{p(state.recovered ? 'recoveryCompleted' : 'completed')}</EmptyTitle></EmptyHeader></Empty>}
          {state.selfHostedBackupPath && (step === 'completed' || step === 'error') && <Alert><HardDrive /><AlertTitle>{p('nativeBackupTitle')}</AlertTitle><AlertDescription className="flex flex-col items-start gap-2 break-all">
            <p>{p('nativeBackupLocation', { path: state.selfHostedBackupPath })}</p>
            {state.selfHostedSafetyBackupPath && <p>{p('nativeSafetyBackupLocation', { path: state.selfHostedSafetyBackupPath })}</p>}
            {state.recovered && <p>{p('nativeRecoveredLocation', { path: useSettingStore.getState().workspacePath })}</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => void (async () => {
              if (!/^self-hosted-switch-backups\/\d+-[a-f0-9-]+$/.test(state.selfHostedBackupPath!)) throw new Error('SELF_HOSTED_BACKUP_INVALID')
              const [{ appDataDir, join }, { openPath }] = await Promise.all([import('@tauri-apps/api/path'), import('@tauri-apps/plugin-opener')])
              await openPath(await join(await appDataDir(), state.selfHostedBackupPath!))
            })().catch(failure => toast({ title: p('failed'), description: String(failure), variant: 'destructive' }))}><FolderOpen data-icon="inline-start" />{p('nativeOpenBackup')}</Button>
          </AlertDescription></Alert>}
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
        </div>
      </div>
      <Separator />
      <footer className="flex max-h-[45dvh] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain bg-muted/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground" role="status">{p('currentPrimary', { platform: platformName(primary) })}</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:[overflow-wrap:anywhere]">
            {step !== 'completed' && step !== 'cancelled' && !state.selfHostedSafetyBackupPath && <Button type="button" variant="outline" disabled={state.cancelRequested} onClick={() => { if (mutated) setConfirmation('cancel'); else void cancelPlatformSwitch() }}>{state.cancelRequested ? <Spinner data-icon="inline-start" /> : <X data-icon="inline-start" />}{p(state.cancelRequested ? 'cancelling' : 'cancelSwitch')}</Button>}
            {step === 'confirm' && <Button type="button" variant="outline" onClick={editPlatformSwitchChoice}><ChevronLeft data-icon="inline-start" />{p('back')}</Button>}
            {step === 'review' && <Button type="button" disabled={!(plan || state.review?.selfHostedPreview) || !canChoose} aria-describedby={draftStrategy === null ? strategyHintId : undefined} onClick={() => {
              if (draftStrategy) choosePlatformSwitchStrategy(draftStrategy)
            }}>{p('continue')}<ArrowRight data-icon="inline-end" /></Button>}
            {step === 'confirm' && <Button type="button" disabled={!canConfirm} aria-describedby={unresolved > 0 ? `${acknowledgeId}-hint` : undefined} onClick={confirmPlatformSwitch}>{p('confirmExecute')}<ArrowRight data-icon="inline-end" /></Button>}
            {stopped && !state.selfHostedSafetyBackupPath && <Button type="button" variant="outline" onClick={() => setConfirmation('skip')}><SkipForward data-icon="inline-start" />{p(step === 'cancelled' ? 'confirmSkip' : 'skipError')}</Button>}
            {(stopped || skipped) && state.selfHostedBackupPath && <Button type="button" variant="outline" onClick={() => setConfirmation('restore')}><HardDrive data-icon="inline-start" />{p('nativeRestoreBackup')}</Button>}
            {step === 'error' && error === 'SELF_HOSTED_PREVIEW_SETTING_DECRYPTION_FAILED' && !mutated && <Button type="button" variant="outline" onClick={() => {
              void continueSelfHostedSwitchWithoutSettings().catch(failure => toast({ title: p('failed'), description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' }))
            }}>{p('nativeContinueWithoutSettings')}<ArrowRight data-icon="inline-end" /></Button>}
            {(stopped || skipped) && <Button type="button" onClick={() => void retryPlatformSwitch()}><RefreshCcw data-icon="inline-start" />{p(skipped ? 'verifySkipped' : 'rescanRetry')}</Button>}
            {step === 'cancelled' && !mutated && <Button type="button" variant="outline" onClick={() => void dismissPlatformSwitch()}>{p('done')}</Button>}
            {step === 'completed' && <Button type="button" onClick={() => void dismissPlatformSwitch()}><Check data-icon="inline-start" />{p('done')}</Button>}
          </div>
        </div>
      </footer>
    </DialogContent>
    <AlertDialog open={confirmation !== null} onOpenChange={next => { if (!next) { setConfirmation(null); setSkipAcknowledged(false) } }}>
      <AlertDialogContent className="max-h-[calc(var(--mobile-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] min-w-0 overflow-y-auto overscroll-contain [&_button]:h-auto [&_button]:min-h-9 [&_button]:whitespace-normal" onCloseAutoFocus={event => { event.preventDefault(); heading.current?.focus() }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{p(confirmation === 'restore' ? 'nativeRestoreBackup' : confirmation === 'skip' ? 'skipTitle' : 'cancelTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation === 'restore' ? p('nativeRestoreDescription') : confirmation === 'skip' ? p('skipDescription', { platform: name }) : p('cancelDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmation === 'skip' && <Field orientation="horizontal"><Checkbox id={skipId} checked={skipAcknowledged} onCheckedChange={value => setSkipAcknowledged(value === true)} /><FieldLabel htmlFor={skipId}>{p('skipAcknowledge')}</FieldLabel></Field>}
        <AlertDialogFooter>
          <AlertDialogCancel>{p(confirmation === 'skip' ? 'cancel' : 'keepSwitching')}</AlertDialogCancel>
          <AlertDialogAction disabled={confirmation === 'skip' && (!skipAcknowledged || !stopped)} onClick={() => {
            const action = confirmation
            setConfirmation(null)
            if (action === 'restore') void recoverSelfHostedSwitchBackup()
            else if (action === 'skip') void skipPlatformSwitchError()
            else void cancelPlatformSwitch()
          }}>{p(confirmation === 'restore' ? 'nativeRestoreBackup' : confirmation === 'skip' ? 'confirmSkip' : 'confirmCancel')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Dialog>
}
