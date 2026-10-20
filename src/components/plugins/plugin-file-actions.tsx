'use client'

import { useEffect, useState } from 'react'
import { getPluginMenuCommands, subscribePluginCommands } from '@/lib/plugins/command-registry'
import { PluginIcon } from './plugin-icon'
import { PluginAction } from './plugin-action'

/** Visible entry points for the same commands available in the file menu. */
export function PluginFileActions() {
  const [commands, setCommands] = useState(() => getPluginMenuCommands('file/context', { resourceKind: 'root' }))
  useEffect(() => subscribePluginCommands(() => {
    setCommands(getPluginMenuCommands('file/context', { resourceKind: 'root' }))
  }), [])
  if (!commands.length) return null
  return <div className="flex flex-wrap gap-1 pt-2">
    {[...new Map(commands.map(command => [command.id, command])).values()].map(command => (
      <PluginAction key={command.id} command={command.id} variant="outline" size="sm" disabled={command.disabled}
        argument={{ kind: 'root', selectedPaths: [] }}>
        <PluginIcon name={command.icon} data-icon="inline-start" />
        {command.title}
      </PluginAction>
    ))}
  </div>
}
