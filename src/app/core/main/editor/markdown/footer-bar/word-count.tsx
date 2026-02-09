'use client'

import { Editor } from '@tiptap/react'
import { useMemo } from 'react'

interface WordCountProps {
  editor: Editor
}

export function WordCount({ editor }: WordCountProps) {
  const { characters } = useMemo(() => {
    if (!editor) return { characters: 0, words: 0 }
    return {
      characters: editor.storage.characterCount?.characters?.() ?? 0,
    }
  }, [editor])

  return (
    <span className="text-xs">{characters} 字符</span>
  )
}
