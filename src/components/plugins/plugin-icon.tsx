import {
  Bookmark, CalendarDays, ChartNoAxesCombined, FileInput, Files,
  FlaskConical, LayoutTemplate, Link, ListChecks, Puzzle, RefreshCw, Shuffle,
  Search, Plus, Minus, Trash2, Pencil, Copy, Check, X, FileText, Folder, FolderOpen,
  Star, Pin, Tag, Settings, MoreHorizontal, ArrowUp, ArrowDown, Download, Upload,
  ExternalLink, List, ListTodo, Table2, Columns3, Clock, BookOpen, Code, Sparkles,
  type LucideIcon,
} from 'lucide-react'

// Keep supported icons explicit so plugin manifests cannot import arbitrary modules.
const icons = new Map<string, LucideIcon>([
  ['bookmark', Bookmark],
  ['search', Search],
  ['plus', Plus],
  ['minus', Minus],
  ['trash-2', Trash2],
  ['pencil', Pencil],
  ['copy', Copy],
  ['check', Check],
  ['x', X],
  ['file-text', FileText],
  ['folder', Folder],
  ['folder-open', FolderOpen],
  ['star', Star],
  ['pin', Pin],
  ['tag', Tag],
  ['settings', Settings],
  ['more-horizontal', MoreHorizontal],
  ['arrow-up', ArrowUp],
  ['arrow-down', ArrowDown],
  ['download', Download],
  ['upload', Upload],
  ['external-link', ExternalLink],
  ['list', List],
  ['list-todo', ListTodo],
  ['table-2', Table2],
  ['columns-3', Columns3],
  ['clock', Clock],
  ['book-open', BookOpen],
  ['code', Code],
  ['sparkles', Sparkles],
  ['calendar-days', CalendarDays],
  ['chart-no-axes-combined', ChartNoAxesCombined],
  ['file-input', FileInput],
  ['files', Files],
  ['flask-conical', FlaskConical],
  ['layout-template', LayoutTemplate],
  ['link', Link],
  ['list-checks', ListChecks],
  ['refresh-cw', RefreshCw],
  ['shuffle', Shuffle],
])

export function getPluginIcon(name?: string): LucideIcon {
  return name ? icons.get(name) ?? Puzzle : Puzzle
}

export function PluginIcon({ name, ...props }: {
  name?: string
  className?: string
  'data-icon'?: 'inline-start' | 'inline-end'
}) {
  const Icon = getPluginIcon(name)
  return <Icon aria-hidden="true" {...props} />
}
