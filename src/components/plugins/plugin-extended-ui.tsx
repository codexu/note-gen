'use client'

import type { PluginExtendedUiBlock, PluginUiBlock } from '@notegen/plugin-api'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ChevronRight } from 'lucide-react'
import { PluginAction } from './plugin-action'
import { PluginIcon } from './plugin-icon'
import { PluginItemList } from './plugin-item-list'
import { cn } from '@/lib/utils'

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
// Plugin content must not load remote images or executable HTML. Links remain
// text: external navigation belongs to an explicit, permission-checked action.
markdown.disable(['image', 'link', 'autolink'])
function Markdown({ text }: { text: string }) {
  const html = useMemo(() => markdown.render(text), [text])
  return <div className="prose prose-sm min-w-0 max-w-none break-words text-foreground" dangerouslySetInnerHTML={{ __html: html }} />
}

export function PluginExtendedUi({ block, scope, render }: {
  block: PluginExtendedUiBlock; scope: string; render: (blocks: readonly PluginUiBlock[]) => ReactNode
}) {
  const [selectedTab, setSelectedTab] = useState('')
  if (block.type === 'item-list') return <PluginItemList block={block} scope={scope} />
  if (block.type === 'markdown') return <Markdown text={block.text} />
  if (block.type === 'badge') return <Badge variant={block.tone ?? 'secondary'}>{block.text}</Badge>
  if (block.type === 'loading') return <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{block.label}</div>
  if (block.type === 'empty') return <Empty><EmptyHeader>{block.icon ? <EmptyMedia variant="icon"><PluginIcon name={block.icon} /></EmptyMedia> : null}<EmptyTitle>{block.title}</EmptyTitle>{block.description ? <EmptyDescription>{block.description}</EmptyDescription> : null}</EmptyHeader></Empty>
  if (block.type === 'toolbar') return <div role="toolbar" aria-label={block.label} className="flex flex-wrap items-center gap-1">{block.actions.map(action => <PluginAction key={action.id} command={action.command} argument={action.argument} confirmation={action.confirmation} label={action.label} size={action.iconOnly ? 'icon-sm' : 'sm'} disabled={action.disabled} variant={action.variant ?? 'ghost'}>{action.icon ? <PluginIcon name={action.icon} data-icon="inline-start" /> : null}{action.iconOnly ? null : action.label}</PluginAction>)}</div>
  if (block.type === 'layout') return <div className={cn('flex min-w-0 [&>*]:min-w-0', block.direction === 'row' ? 'flex-row flex-wrap items-start' : 'flex-col', block.gap === 'small' ? 'gap-1' : block.gap === 'large' ? 'gap-6' : 'gap-3')}>{render(block.blocks)}</div>
  if (block.type === 'section') {
    if (!block.collapsible) return <section className="flex min-w-0 flex-col gap-2"><h3 className="text-sm font-medium">{block.title}</h3>{render(block.blocks)}</section>
    return <Collapsible defaultOpen={block.defaultOpen ?? true}><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="group"><ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />{block.title}</Button></CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-2">{render(block.blocks)}</CollapsibleContent></Collapsible>
  }
  return <Tabs value={block.tabs.some(tab => tab.id === selectedTab) ? selectedTab : block.tabs[0].id} onValueChange={setSelectedTab}><TabsList aria-label={block.label}>{block.tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}</TabsList>{block.tabs.map(tab => <TabsContent key={tab.id} value={tab.id}>{render(tab.blocks)}</TabsContent>)}</Tabs>
}
