'use client'

import { Editor } from '@tiptap/react'
import { List, ListCollapse } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface OutlineToggleProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function OutlineToggle({
  editor,
  outlineOpen,
  onToggleOutline,
}: OutlineToggleProps) {
  const t = useTranslations('editor')

  if (!editor) return null

  return (
    <button
      onClick={onToggleOutline}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[hsl(var(--muted))] transition-colors"
      title={outlineOpen ? t('outline.close') : t('outline.open')}
    >
      {outlineOpen ? (
        <ListCollapse size={14} />
      ) : (
        <List size={14} />
      )}
      <span>{t('outline.title')}</span>
    </button>
  )
}

export default OutlineToggle
