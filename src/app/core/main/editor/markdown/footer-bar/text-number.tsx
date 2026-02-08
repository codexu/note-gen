'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

interface TextNumberProps {
  editor: Editor
}

export function TextNumber({ editor }: TextNumberProps) {
  const [characterCount, setCharacterCount] = useState({ characters: 0, words: 0 })

  useEffect(() => {
    if (!editor) return

    const updateCount = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = editor.storage as any
      const chars = storage.characterCount?.characterCount?.() || 0
      const words = storage.characterCount?.words?.() || 0
      setCharacterCount({ characters: chars, words })
    }

    updateCount()
    editor.on('update', updateCount)
    editor.on('selectionUpdate', updateCount)

    return () => {
      editor.off('update', updateCount)
      editor.off('selectionUpdate', updateCount)
    }
  }, [editor])

  return (
    <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
      <span>{characterCount.words} 字</span>
      <span className="text-[hsl(var(--border))]">/</span>
      <span>{characterCount.characters} 字符</span>
    </div>
  )
}

export default TextNumber
