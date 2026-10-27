"use client"

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getChatResponseText, getResponseCodeFence, type ResponseComponentProps } from '@/lib/chat-ui/response-catalog'
import type { ResponseIconName } from '@/lib/chat-ui/response-icons'
import { normalizeLatexForKatex } from '@/lib/latex'
import ChatPreview from '@/app/core/main/chat/chat-preview'
import { StreamdownRenderer } from '@/components/markdown/streamdown-renderer'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useChatResponseContext } from './response-context'
import { ResponseIcon } from './response-icon'
import 'katex/dist/katex.min.css'

export function ResponseMarkdown({ text }: { text: string }) {
  const { artifacts, isPreview } = useChatResponseContext()
  return <ChatPreview text={text} artifacts={artifacts} interactive={!isPreview} />
}

/** Structured text uses the same typography, sizing and controls as an ordinary chat reply. */
export function ResponseTypography({ type, props, icon }: {
  type: 'Text' | 'Heading' | 'List' | 'Table'
  props: Record<string, unknown>
  icon?: ResponseIconName
}) {
  const markdown = useMemo(() => {
    if ((type === 'Text' || type === 'Heading') && (typeof props.text !== 'string' || !props.text.trim())) return ''
    return getChatResponseText({ root: 'content', elements: { content: { type, props, children: [] } } })
  }, [type, props])
  if (!markdown) return null
  return icon ? <div className="flex min-w-0 items-center gap-2">
    <ResponseIcon name={icon} /><ResponseMarkdown text={markdown} />
  </div> : <ResponseMarkdown text={markdown} />
}

export function ResponseMath({ latex, displayMode = true, label }: ResponseComponentProps<'Math'>) {
  const t = useTranslations('record.chat.response')
  const [rendered, setRendered] = useState<{ latex: string; displayMode: boolean; html?: string; failed?: boolean }>()
  useEffect(() => {
    let cancelled = false
    void import('katex').then(({ default: katex }) => {
      const html = katex.renderToString(normalizeLatexForKatex(latex), {
        displayMode, throwOnError: true, trust: false, maxExpand: 1_000, maxSize: 20,
      })
      if (!cancelled) setRendered({ latex, displayMode, html })
    }).catch(() => { if (!cancelled) setRendered({ latex, displayMode, failed: true }) })
    return () => { cancelled = true }
  }, [latex, displayMode])
  const current = rendered?.latex === latex && rendered.displayMode === displayMode ? rendered : undefined
  return <figure className="min-w-0">
    {label && <figcaption className="mb-2 text-sm text-muted-foreground">{label}</figcaption>}
    {current?.failed ? <Alert variant="destructive"><AlertDescription>{t('mathFailed')}<code className="whitespace-pre-wrap break-words">{latex}</code></AlertDescription></Alert>
      : current?.html ? <div className="overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: current.html }} />
        : <code className="whitespace-pre-wrap break-words">{latex}</code>}
  </figure>
}

export function ResponseCodeBlock({ code, language, title }: ResponseComponentProps<'CodeBlock'>) {
  const { artifacts, isPreview } = useChatResponseContext()
  const markdown = useMemo(() => getResponseCodeFence(code, language), [code, language])
  return <div className="min-w-0">
    {title && <p className="mb-2 text-sm text-muted-foreground">{title}</p>}
    <StreamdownRenderer markdown={markdown} artifacts={artifacts} interactive={!isPreview} />
  </div>
}

export function ResponseAccordion({ items, defaultOpen = [] }: ResponseComponentProps<'Accordion'>) {
  return <Accordion type="multiple" defaultValue={defaultOpen.map(String)}>
    {items.map((item, index) => <AccordionItem key={index} value={String(index)}>
      <AccordionTrigger><span className="flex min-w-0 items-center gap-2"><ResponseIcon name={item.icon} />{item.title}</span></AccordionTrigger>
      <AccordionContent><ResponseMarkdown text={item.content} /></AccordionContent>
    </AccordionItem>)}
  </Accordion>
}

export function ResponseTabs({ items, defaultIndex = 0 }: ResponseComponentProps<'Tabs'>) {
  return <Tabs defaultValue={String(defaultIndex)}>
    <div className="max-w-full overflow-x-auto">
      <TabsList>{items.map((item, index) => <TabsTrigger key={index} value={String(index)}>
        <ResponseIcon name={item.icon} data-icon="inline-start" />{item.title}
      </TabsTrigger>)}</TabsList>
    </div>
    {items.map((item, index) => <TabsContent key={index} value={String(index)}><ResponseMarkdown text={item.content} /></TabsContent>)}
  </Tabs>
}

export function ResponseSteps({ items }: ResponseComponentProps<'Steps'>) {
  const t = useTranslations('record.chat.response')
  return <ol className="flex min-w-0 flex-col gap-4">{items.map((item, index) => <li key={index} className="flex min-w-0 items-start gap-3">
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
      {item.icon || item.status === 'done' ? <ResponseIcon name={item.icon ?? 'check-circle'} /> : index + 1}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2"><p className="break-words font-medium">{item.title}</p>
        {item.status && <Badge variant={item.status === 'done' ? 'success' : 'secondary'}>{t(`step.${item.status}`)}</Badge>}
      </div>
      {item.description && <ResponseMarkdown text={item.description} />}
    </div>
  </li>)}</ol>
}

export function ResponseTimeline({ items }: ResponseComponentProps<'Timeline'>) {
  return <ol className="flex min-w-0 flex-col gap-4">{items.map((item, index) => <li key={index} className="flex min-w-0 items-start gap-3">
    <span className="mt-1 shrink-0"><ResponseIcon name={item.icon ?? 'clock'} /></span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {item.time && <p className="text-sm text-muted-foreground">{item.time}</p>}
      <p className="break-words font-medium">{item.title}</p>
      {item.description && <ResponseMarkdown text={item.description} />}
    </div>
  </li>)}</ol>
}
