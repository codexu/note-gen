'use client'

import type { Editor } from '@tiptap/core'
import { Fragment, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { toast } from 'sonner'
import { PluginIcon } from './plugin-icon'
import { usePluginEditorCommands } from './use-plugin-editor-commands'

export function PluginEditorToolbar({ editor, location, owner }: { editor: Editor; location: 'editor/selection' | 'editor/toolbar'; owner?: string }) {
  const instance = useId()
  const commands = usePluginEditorCommands(location, editor)
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const t = useTranslations('settings.plugins.ui')
  if (!commands.length) return null
  async function run(id: string) {
    if (busy.current || editor.isDestroyed) return
    const current = commands.find(command => command.id === id)
    if (!current || current.disabled) return
    busy.current = true; setPending(true)
    // Focus the existing selection; never restore an old selection after an
    // asynchronous command has changed the document.
    editor.view.focus()
    try { await executePluginCommand(id, { kind: 'editor', editorKind: 'markdown', location }) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { busy.current = false; setPending(false) }
  }
  return <div className="flex items-center gap-0.5" onMouseDown={event => event.preventDefault()}>
    {commands.slice(0, 3).map(command => <Button key={command.id} type="button" variant="ghost" size="icon-sm" disabled={pending || command.disabled} title={command.title} aria-label={command.title} onClick={() => void run(command.id)}><PluginIcon name={command.icon} /></Button>)}
    {commands.length > 3 ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={t('moreActions')}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent data-plugin-menu-owner={owner ?? instance} onCloseAutoFocus={event => event.preventDefault()}><DropdownMenuGroup>
      {commands.slice(3).map((command, index, items) => <Fragment key={command.id}>{index > 0 && command.group !== items[index - 1].group ? <DropdownMenuSeparator /> : null}<DropdownMenuItem disabled={pending || command.disabled} onSelect={() => void run(command.id)}><PluginIcon name={command.icon} />{command.title}</DropdownMenuItem></Fragment>)}
    </DropdownMenuGroup></DropdownMenuContent></DropdownMenu> : null}
  </div>
}
