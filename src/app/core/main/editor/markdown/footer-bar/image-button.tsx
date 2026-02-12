'use client'

import { Editor } from '@tiptap/react'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import { useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { handleImageUpload } from '@/lib/image-handler'
import { toast } from '@/hooks/use-toast'
import { useTranslations } from 'next-intl'

interface ImageButtonProps {
  editor: Editor
  activeFilePath?: string
}

export function ImageButton({ editor, activeFilePath }: ImageButtonProps) {
  const [isUploading, setIsUploading] = useState(false)
  const t = useTranslations('editor.image')

  const handleImageSelect = useCallback(async () => {
    if (!editor) return

    try {
      // 打开文件选择对话框
      const file = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
          },
        ],
      })

      if (!file) return

      setIsUploading(true)

      const fileObj = typeof file === 'string' ? new File([file], file.split('/').pop() || 'image', { type: 'image/*' }) : file

      const result = await handleImageUpload(fileObj, activeFilePath)

      // 插入图片到编辑器
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: result.src,
          alt: fileObj.name,
          relativeSrc: result.relativePath,
        },
      }).run()

      toast({
        title: result.useImageHosting ? t('uploadSuccess') : t('saveSuccess'),
        description: result.useImageHosting ? '' : `保存路径: ${result.relativePath}`,
      })
    } catch (error) {
      toast({
        title: t('uploadFailed'),
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setIsUploading(false)
    }
  }, [editor, activeFilePath, t])

  return (
    <button
      onClick={handleImageSelect}
      disabled={isUploading}
      className="flex items-center gap-1 px-2 py-0.5 hover:bg-accent rounded transition-colors disabled:opacity-50"
      title={t('insert')}
    >
      {isUploading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <ImageIcon className="w-4 h-4" />
      )}
    </button>
  )
}
