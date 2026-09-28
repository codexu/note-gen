'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { PluginUiBlock, PluginUiDocument } from '@notegen/plugin-api'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { executePluginUserCommand } from '@/lib/plugins/command-registry'
import { PluginArticlePreview } from './plugin-article-preview'
import { PluginDeclarativeUi } from './plugin-declarative-ui'

type Toolbar = Extract<PluginUiBlock, { type: 'toolbar' }>

function PreviewTabs({ block }: { block: Toolbar }) {
  const [pending, setPending] = useState(false)
  const selected = block.actions.find(action => action.variant === 'default')?.id ?? block.actions[0]?.id
  return <Tabs value={selected} onValueChange={value => {
    const action = block.actions.find(item => item.id === value)
    if (!action || pending || action.id === selected) return
    setPending(true)
    void executePluginUserCommand(action.command, action.argument)
      .catch(error => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setPending(false))
  }}>
    <TabsList aria-label={block.label}>
      {block.actions.map(action => <TabsTrigger key={action.id} value={action.id} disabled={pending || action.disabled}>{action.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>
}

export function PluginArticleDrawer({ document, scope }: { document: PluginUiDocument; scope: string }) {
  const picker = document.blocks.find(block => block.type === 'form')
  const output = document.blocks.find(block => block.type === 'toolbar' && block.id === 'output')
  const devices = document.blocks.find(block => block.type === 'toolbar' && block.id === 'preview-width')
  const preview = document.blocks.find(block => block.type === 'document-preview')
  const display = document.blocks.filter(block => block !== picker && block !== output && block !== devices && block !== preview)
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="shrink-0 border-b px-4 py-3">
      {picker ? <PluginDeclarativeUi scope={scope} document={{ blocks: [picker] }} nested /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {output ? <PluginDeclarativeUi scope={scope} document={{ blocks: [output] }} nested /> : null}
        {devices?.type === 'toolbar' ? <div className="ml-auto shrink-0"><PreviewTabs block={devices} /></div> : null}
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      {display.length ? <div className={preview ? 'max-h-24 shrink-0 overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto'}><div className="flex flex-col gap-2"><PluginDeclarativeUi scope={scope} document={{ blocks: display }} nested /></div></div> : null}
      {preview?.type === 'document-preview' ? <div className="min-h-0 flex-1"><PluginArticlePreview block={preview} scope={scope} /></div> : null}
    </div>
  </div>
}
