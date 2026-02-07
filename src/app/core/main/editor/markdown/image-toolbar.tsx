'use client'

import { Editor } from '@tiptap/react'
import { Image } from 'lucide-react'
import { useCallback, useRef } from 'react'

interface ImageToolbarProps {
  editor: Editor
}

export function ImageToolbar({ editor }: ImageToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && file.type.startsWith('image/')) {
        // Use the editor's image upload command
        const reader = new FileReader()
        reader.onload = (event) => {
          const base64 = event.target?.result as string
          // Insert temporary image
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(editor.commands as any).setImage({ src: base64, 'data-upload-status': 'pending' })
        }
        reader.readAsDataURL(file)
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [editor]
  )

  const canInsertImage = editor.can().insertContent({ type: 'image' })

  return (
    <div className="image-toolbar flex items-center">
      <button
        onClick={triggerFilePicker}
        disabled={!canInsertImage}
        className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
        title="插入图片"
      >
        <Image size={18} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
