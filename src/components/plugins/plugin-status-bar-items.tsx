'use client'

import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'

import { Spinner } from '@/components/ui/spinner'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { toast } from '@/hooks/use-toast'
import type { PluginStatusBarContribution } from '@/lib/plugins/types'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { usePluginStore } from '@/stores/plugins'

interface StatusItem {
  pluginId: string
  contribution: PluginStatusBarContribution
  stateKey: string
}

export function PluginStatusBarItems({
  alignment,
  compact = false,
}: {
  alignment: 'left' | 'right'
  compact?: boolean
}) {
  const displaySettings = usePluginStore(state => state.deviceSettings)
  const installed = usePluginStore((state) => state.installed)
  const workspaceStates = usePluginStore((state) => state.workspaceStates)
  const workspaceId = usePluginStore((state) => state.currentWorkspaceId)
  const statusBar = usePluginStore((state) => state.statusBar)

  const items = useMemo(() => {
    if (!workspaceId) return []
    return installed.flatMap<StatusItem>((plugin) => {
      if (!isPluginEnabledInWorkspace(plugin, workspaceStates[workspaceId]?.[plugin.manifest.id])) return []
      return (plugin.manifest.contributes.statusBar ?? [])
        .filter((item) => item.alignment === alignment)
        .map((contribution) => ({
          pluginId: plugin.manifest.id,
          contribution,
          stateKey: `${plugin.manifest.id}:${contribution.id}`,
        }))
    }).sort((left, right) => (
      (right.contribution.priority ?? 0) - (left.contribution.priority ?? 0)
      || left.contribution.id.localeCompare(right.contribution.id)
    ))
  }, [alignment, installed, workspaceId, workspaceStates])

  const visibleItems = items.filter((item) => isPluginDisplayVisible(displaySettings, item.pluginId, 'status-bar') && statusBar[item.stateKey]?.visible)
  if (visibleItems.length === 0) return null

  return (
    <TooltipProvider>
      <div className="flex h-full shrink-0 items-center gap-0.5">
        {visibleItems.map(({ contribution, stateKey }) => {
          const state = statusBar[stateKey]
          const text = compact ? state.compactText ?? state.text : state.text ?? state.compactText
          if (!text && !state.busy) return null
          const content = (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              {state.busy ? <Spinner data-icon="inline-start" /> : null}
              {text ? <span>{text}</span> : null}
            </span>
          )
          const item = contribution.command ? (
            <Button
              key={stateKey}
              type="button"
              size="xs"
              variant="ghost"
              disabled={state.busy}
              aria-busy={Boolean(state.busy)}
              aria-label={state.accessibleLabel ?? state.tooltip ?? text}
              onClick={() => void executePluginCommand(contribution.command!).catch((error) => {
                toast({
                  description: error instanceof Error ? error.message : String(error),
                  variant: 'destructive',
                })
              })}
            >
              {content}
            </Button>
          ) : (
            <span
              key={stateKey}
              className="inline-flex h-full items-center px-1.5"
              aria-label={state.accessibleLabel}
            >
              {content}
            </span>
          )

          if (!state.tooltip) return item
          return (
            <Tooltip key={stateKey}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent className="whitespace-pre-line">{state.tooltip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
