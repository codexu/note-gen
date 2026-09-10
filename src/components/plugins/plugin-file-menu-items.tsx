'use client'

import { PluginIcon } from './plugin-icon'
import { Fragment, useEffect, useState } from 'react'
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/enhanced-context-menu'
import { toast } from '@/hooks/use-toast'
import {
  executePluginCommand,
  getPluginMenuCommands,
  subscribePluginCommands,
} from '@/lib/plugins/command-registry'

export type PluginFileMenuContext = {
  kind: 'file' | 'folder' | 'root'
  relativePath?: string
  selectedPaths?: string[]
}

export function PluginFileMenuItems({ context, location = 'file/context' }: { context: PluginFileMenuContext; location?: 'file/context' | 'tab/context' }) {
  const [, refresh] = useState(0)
  useEffect(() => subscribePluginCommands(() => refresh(value => value + 1)), [])
  const menuContext = { resourceKind: context.kind, resourceExt: context.relativePath?.split('.').pop()?.toLowerCase() }
  const commands = [...new Map([
    ...(location === 'tab/context' ? getPluginMenuCommands('file/context', menuContext, location) : []),
    ...getPluginMenuCommands(location, menuContext),
  ].map(command => [command.id, command])).values()]

  if (commands.length === 0) return null
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {commands.map((command, index) => (
          <Fragment key={command.id}>{index > 0 && command.group !== commands[index - 1].group ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            disabled={command.disabled}
            inset
            menuType="file"
            onClick={() => void executePluginCommand(command.id, context).catch((error) => {
              toast({
                title: command.title,
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive',
              })
            })}
          >
            <PluginIcon name={command.icon} className="mr-2" />
            {command.title}
          </ContextMenuItem></Fragment>
        ))}
      </ContextMenuGroup>
    </>
  )
}
