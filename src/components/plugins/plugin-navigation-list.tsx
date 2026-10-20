'use client'

import type { PluginNavigationListBlock } from '@notegen/plugin-api'
import { PluginItemList } from './plugin-item-list'
import { PluginAction } from './plugin-action'
import { Plus } from 'lucide-react'

/** Compatibility for existing 0.1.0 development packages. */
export function PluginNavigationList({ block, scope }: { block: PluginNavigationListBlock; scope: string }) {
  return <section aria-label={block.label}>
    <div className="flex justify-end"><PluginAction command={block.addCommand} argument={{ generation: block.generation }} variant="ghost" size="icon-sm" label={block.addLabel}><Plus /></PluginAction></div>
    <PluginItemList scope={scope} block={{ type: 'item-list', id: block.id, generation: block.generation, label: block.label, emptyText: block.emptyText,
      items: block.items.map(item => ({ ...item, icon: 'file-text' })), openCommand: block.openCommand, reorderCommand: block.reorderCommand, reorderLabel: block.reorderLabel,
      actions: [{ id: 'remove', label: block.removeLabel, icon: 'trash-2', command: block.removeCommand }],
    }} />
  </section>
}
