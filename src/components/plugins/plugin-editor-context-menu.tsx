'use client'

import { PluginIcon } from './plugin-icon'
import { type ReactNode, Fragment } from 'react'
import type { Editor } from '@tiptap/core'
import { usePluginEditorCommands } from './use-plugin-editor-commands'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { toast } from '@/hooks/use-toast'
import {
  executePluginCommand,
} from '@/lib/plugins/command-registry'

export function PluginEditorContextMenu({
  children,
  editor,
  enabled = true,
}: {
  children: ReactNode
  editor?: Editor | null
  enabled?: boolean
}) {
  const commands = usePluginEditorCommands('editor/context', editor)

  if (!enabled) return <>{children}</>

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={commands.length === 0}
        onContextMenuCapture={(event) => {
          // Keep the platform's copy, paste and spelling menu on a normal right-click.
          // Holding Alt/Option opens the plugin-contributed editor menu instead.
          if (!event.altKey) event.stopPropagation()
        }}
      >
        {children}
      </ContextMenuTrigger>
      {commands.length > 0 ? (
        <ContextMenuContent>
          <ContextMenuGroup>
          {commands.map((command, index) => (
            <Fragment key={command.id}>{index > 0 && command.group !== commands[index - 1].group ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              disabled={command.disabled}
              onSelect={() => void executePluginCommand(command.id, {
                kind: 'editor',
                editorKind: 'markdown',
              }).catch((error) => {
                toast({
                  title: command.title,
                  description: error instanceof Error ? error.message : String(error),
                  variant: 'destructive',
                })
              })}
            >
              <PluginIcon name={command.icon} />
              {command.title}
            </ContextMenuItem></Fragment>
          ))}
          </ContextMenuGroup>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  )
}
