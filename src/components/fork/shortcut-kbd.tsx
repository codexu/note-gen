'use client'

// Fork（almanac P0-c）：快捷鍵 pill。⌘⇧⌥⌃ 用 lucide icon 畫，組合鍵包成一顆 pill。
import { ArrowBigUp, ChevronUp, Command, Option } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

const MOD_ICON: Record<string, React.ReactNode> = {
  '⌘': <Command aria-hidden />,
  '⇧': <ArrowBigUp aria-hidden />,
  '⌥': <Option aria-hidden />,
  '⌃': <ChevronUp aria-hidden />,
}

const WORD_TO_SYMBOL: Record<string, string> = {
  mod: '⌘', cmd: '⌘', meta: '⌘', command: '⌘',
  shift: '⇧', alt: '⌥', option: '⌥', ctrl: '⌃', control: '⌃',
}

/** 接受 "⌘K"、"⌘⇧P"、"Mod+Shift+P" 兩種寫法。 */
export function parseShortcut(input: string): string[] {
  if (input.includes('+') && input.length > 1) {
    return input.split('+').map(part => WORD_TO_SYMBOL[part.trim().toLowerCase()] ?? part.trim().toUpperCase())
  }
  return Array.from(input)
}

export function ShortcutKbd({ shortcut, className }: { shortcut: string, className?: string }) {
  const keys = parseShortcut(shortcut)
  return (
    <Kbd className={className} aria-label={shortcut}>
      {keys.map((key, index) => (
        <span key={index} className={cn('inline-flex items-center', MOD_ICON[key] && '[&>svg]:size-[11px]')}>
          {MOD_ICON[key] ?? key}
        </span>
      ))}
    </Kbd>
  )
}
