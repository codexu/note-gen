'use client'

import type { PluginUiDocument, PluginUiBlock } from '@notegen/plugin-api'
import { PluginExtendedUi } from './plugin-extended-ui'
import { PluginAction } from './plugin-action'
import { PluginNavigationList } from './plugin-navigation-list'
import { PluginForm } from './plugin-form'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'
import { usePluginSettingsLayout } from './plugin-settings-layout'
import { Item, ItemContent, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

function TreeItems({ items, parentId, depth = 0 }: { items: Extract<PluginUiBlock, { type: 'tree' }>['items']; parentId?: string; depth?: number }) {
  if (depth >= 8) return null
  return <ul className="flex flex-col gap-1 pl-3">{items.filter(item => item.parentId === parentId).map(item => {
    const children = items.some(child => child.parentId === item.id)
    const label = item.command ? <PluginAction variant="ghost" command={item.command} argument={item.argument}>{item.label}</PluginAction> : <span className="text-sm">{item.label}</span>
    if (!children) return <li key={item.id} className="pl-8">{label}</li>
    return (
      <Collapsible key={item.id} asChild>
        <li>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="group shrink-0" aria-label={item.label}>
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
              </Button>
            </CollapsibleTrigger>
            {label}
          </div>
          <CollapsibleContent>
            <TreeItems items={items} parentId={item.id} depth={depth + 1} />
          </CollapsibleContent>
        </li>
      </Collapsible>
    )
  })}</ul>
}

export function PluginDeclarativeUi({ document, scope, nested = false, compact = false }: { document?: PluginUiDocument; scope: string; nested?: boolean; compact?: boolean }) {
  const settingsLayout = usePluginSettingsLayout()
  const t = useTranslations('settings.plugins.ui')
  if (!document || document.blocks.length === 0) return <Empty><EmptyHeader><EmptyDescription>{t('empty')}</EmptyDescription></EmptyHeader></Empty>
  return <div className={cn('flex min-w-0 flex-col gap-4 break-words', settingsLayout ? nested ? 'contents' : 'p-0 gap-5' : compact ? 'h-8 flex-row items-center gap-1 whitespace-nowrap [&>*]:shrink-0' : nested ? 'contents' : document.blocks.length === 1 && (document.blocks[0].type === 'navigation-list' || document.blocks[0].type === 'item-list') ? 'p-1' : 'p-3')}>{document.blocks.map((block, index) => {
    if (block.type === 'kanban' || block.type === 'layout' || block.type === 'section' || block.type === 'tabs' || block.type === 'toolbar' || block.type === 'item-list' || block.type === 'markdown' || block.type === 'badge' || block.type === 'empty' || block.type === 'loading') return <PluginExtendedUi key={'id' in block ? `${block.type}:${block.id}` : index} block={block} scope={scope} compact={compact} render={blocks => <PluginDeclarativeUi scope={scope} document={{ blocks }} nested />} />
    if (block.type === 'navigation-list') return <PluginNavigationList key={`navigation:${block.id}`} block={block} scope={scope} />
    if (block.type === 'separator') return <Separator key={index} orientation={compact ? "vertical" : "horizontal"} className={compact ? "h-4" : undefined} />
    if (block.type === 'callout') return <Alert key={index} variant={block.tone ?? 'default'}><AlertTitle>{block.title}</AlertTitle><AlertDescription className="whitespace-pre-wrap break-words">{block.text}</AlertDescription></Alert>
    if (block.type === 'progress') return <div key={index} className={compact ? "flex w-32 items-center gap-2" : "flex flex-col gap-2"}><p className="text-sm">{block.label}</p><Progress value={block.value} aria-label={block.label} aria-valuenow={block.value} /></div>
    if (block.type === 'form') return <PluginForm key={`form:${block.id}`} block={block} scope={scope} />
    if (block.type === 'table') return <Table key={block.id ? `table:${block.id}` : index}><TableHeader><TableRow>{block.columns.map((column, columnIndex) => <TableHead key={columnIndex}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{block.rows.map((row, rowIndex) => <TableRow key={block.rowIds?.[rowIndex] ?? rowIndex}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{typeof cell === 'string' ? cell : <PluginAction variant="link" command={cell.command} argument={cell.argument} disabled={cell.disabled}>{cell.text}</PluginAction>}</TableCell>)}</TableRow>)}</TableBody></Table>
    if (block.type === 'tree') return <TreeItems key={`tree:${index}`} items={block.items} />
    if (block.type === 'heading') return <h3 key={index} className="font-semibold">{block.text}</h3>
    if (block.type === 'text') return <p key={index} className={cn(compact ? 'max-w-48 truncate text-sm' : 'whitespace-pre-wrap text-sm', block.tone === 'muted' && 'text-muted-foreground', block.tone === 'warning' && 'text-destructive')}>{block.text}</p>
    if (block.type === 'list') return <ul key={index} className="flex list-disc flex-col gap-1 pl-5 text-sm">{block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
    if (block.type === 'key-value' && settingsLayout) return <div key={index} className="flex flex-col gap-3">{block.items.map((item, itemIndex) => <Item key={itemIndex} variant="outline"><ItemContent className="min-w-0"><ItemTitle>{item.label}</ItemTitle></ItemContent><div className="min-w-0 break-words">{item.value}</div></Item>)}</div>
    if (block.type === 'key-value') return <dl key={index} className="flex flex-col gap-2 text-sm">{block.items.map((item, itemIndex) => <div key={itemIndex} className="flex justify-between gap-4"><dt className="text-muted-foreground">{item.label}</dt><dd className="min-w-0 break-all text-right">{item.value}</dd></div>)}</dl>
    return <div key={index} className={settingsLayout ? "flex flex-wrap justify-end gap-2" : compact ? "flex items-center gap-1" : "flex flex-wrap gap-2"}>{block.actions.map((action) => <PluginAction key={action.id} disabled={action.disabled} variant={action.variant} command={action.command} argument={action.argument}>{action.label}</PluginAction>)}</div>
  })}</div>
}
