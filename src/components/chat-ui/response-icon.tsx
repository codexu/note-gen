"use client"

import {
  FileText, Folder, Search, Calendar, Lightbulb, CircleCheck, TriangleAlert,
  Code, Calculator, Info, BookOpen, ListChecks, Clock, Image, Quote, Link,
  ExternalLink, Copy, Download, ChartColumn, type LucideIcon,
} from 'lucide-react'
import type { ResponseIconName } from '@/lib/chat-ui/response-icons'

const icons: Record<ResponseIconName, LucideIcon> = {
  'file-text': FileText, folder: Folder, search: Search, calendar: Calendar,
  lightbulb: Lightbulb, 'check-circle': CircleCheck, 'triangle-alert': TriangleAlert,
  code: Code, calculator: Calculator, info: Info, 'book-open': BookOpen,
  'list-checks': ListChecks, clock: Clock, image: Image, quote: Quote, link: Link,
  'external-link': ExternalLink, copy: Copy, download: Download, 'chart-column': ChartColumn,
}

export function ResponseIcon({ name, label, size = 16, className, 'data-icon': dataIcon }: {
  name?: ResponseIconName
  label?: string
  size?: number
  className?: string
  'data-icon'?: 'inline-start' | 'inline-end'
}) {
  if (!name) return null
  const Icon = icons[name]
  return <Icon size={size} className={className ?? 'shrink-0'} data-icon={dataIcon}
    aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} />
}
