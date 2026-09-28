'use client'

import { useMemo, type ReactNode } from 'react'

import { StatusBarItem } from '@/app/core/main/status-bar-order'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { executePluginUserCommand } from '@/lib/plugins/command-registry'
import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import type { PluginStatusBarContribution, PluginStatusBarState } from '@/lib/plugins/types'
import { usePluginStore } from '@/stores/plugins'
import { PluginEmbeddedView, useEmbeddedPluginViews } from './plugin-embedded-views'

type EmbeddedItem = ReturnType<typeof useEmbeddedPluginViews>[number]
type StatusItem = {
  kind: 'status'
  key: string
  contribution: PluginStatusBarContribution
  state: PluginStatusBarState
}
type ViewItem = { kind: 'view'; key: string; view: EmbeddedItem }
type Item = StatusItem | ViewItem

function SortableItem({ item, index }: { item: Item; index: number }) {
  const label = item.kind === 'view'
    ? item.view.title
    : item.state.accessibleLabel ?? item.state.tooltip ?? item.state.text ?? item.key

  let content: ReactNode
  if (item.kind === 'view') {
    content = <PluginEmbeddedView item={item.view} compact popover card={false} />
  } else {
    const { contribution, state } = item
    const text = state.text ?? state.compactText
    const inner = (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {state.busy ? <Spinner data-icon="inline-start" /> : null}
        {text ? <span>{text}</span> : null}
      </span>
    )
    const control = contribution.command ? (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={state.busy}
        aria-busy={Boolean(state.busy)}
        aria-label={label}
        onClick={() => void executePluginUserCommand(contribution.command!).catch(error => {
          toast({ description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        })}
      >
        {inner}
      </Button>
    ) : <span className="inline-flex h-full items-center px-1.5" aria-label={label}>{inner}</span>

    content = state.tooltip ? (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent className="whitespace-pre-line">{state.tooltip}</TooltipContent>
      </Tooltip>
    ) : control
  }

  return (
    <StatusBarItem id={item.key} rank={50 + index / 100}>
      {content}
    </StatusBarItem>
  )
}

export function PluginStatusBarCenter() {
  const installed = usePluginStore(state => state.installed)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const statusBar = usePluginStore(state => state.statusBar)
  const views = useEmbeddedPluginViews('status-bar-panel')
  const items = useMemo<Item[]>(() => {
    if (!workspaceId) return []
    const contributions = installed.flatMap<StatusItem>(plugin => {
      const pluginId = plugin.manifest.id
      if (!isPluginEnabledInWorkspace(plugin, workspaceStates[workspaceId]?.[pluginId])
        || !isPluginDisplayVisible(displaySettings, pluginId, 'status-bar')) return []
      return (plugin.manifest.contributes.statusBar ?? []).flatMap(contribution => {
        const stateKey = `${pluginId}:${contribution.id}`
        const state = statusBar[stateKey]
        if (!state?.visible || (!state.text && !state.compactText && !state.busy)) return []
        return [{ kind: 'status' as const, key: `status:${stateKey}`, contribution, state }]
      })
    }).sort((left, right) => (
      (left.contribution.alignment === 'left' ? 0 : 1) - (right.contribution.alignment === 'left' ? 0 : 1)
      || (right.contribution.priority ?? 0) - (left.contribution.priority ?? 0)
      || left.key.localeCompare(right.key)
    ))
    return [...contributions, ...views.map(view => ({ kind: 'view' as const, key: `view:${view.key}`, view }))]
  }, [displaySettings, installed, statusBar, views, workspaceId, workspaceStates])

  if (!items.length) return null
  return (
    <TooltipProvider>
      {items.map((item, index) => <SortableItem key={item.key} item={item} index={index} />)}
    </TooltipProvider>
  )
}
