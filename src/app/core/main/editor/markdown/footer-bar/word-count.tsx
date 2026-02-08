'use client'

import { Editor } from '@tiptap/react'
import { useMemo } from 'react'

interface WordCountProps {
  editor: Editor
}

export function WordCount({ editor }: WordCountProps) {
  const { characters, words } = useMemo(() => {
    if (!editor) return { characters: 0, words: 0 }
    return {
      characters: editor.storage.characterCount?.characters?.() ?? 0,
      words: editor.storage.characterCount?.words?.() ?? 0,
    }
  }, [editor])

  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span>{words} 字</span>
      <span className="text-[10px] opacity-60">{characters} 字符</span>
    </span>
  )
}
