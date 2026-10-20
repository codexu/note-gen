import { TooltipButton } from "@/components/tooltip-button"
import { insertMark, Mark } from "@/db/marks"
import { useTranslations } from 'next-intl'
import { recognizeImageWithFallback } from "@/lib/image-recognition"
import useMarkStore from "@/stores/mark"
import { BaseDirectory, exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs"
import { ImagePlus } from "lucide-react"
import useSettingStore from "@/stores/setting"
import { v4 as uuid } from 'uuid'
import { open } from '@tauri-apps/plugin-dialog';
import { uploadImage } from "@/lib/imageHosting"
import { useRef, useEffect, useCallback } from 'react'
import { isMobileDevice } from '@/lib/check'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import { useRecordCompletion } from './use-record-completion'
import { getImageRecognitionProgressText } from "@/lib/image-recognition-progress"
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'

function isPickerCancelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('cancel')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function bytesToDataUrl(bytes: Uint8Array, extension: string) {
  return `data:${getImageMimeType(extension)};base64,${bytesToBase64(bytes)}`
}

function getPathExtension(path: string) {
  const cleanPath = path.split(/[?#]/)[0] || ''
  const filename = cleanPath.split('/').pop() || ''
  const dotIndex = filename.lastIndexOf('.')

  if (dotIndex < 0) {
    return null
  }

  return normalizeImageExtension(filename.slice(dotIndex + 1))
}

function normalizeImageExtension(extension: string | null | undefined) {
  const normalized = extension?.trim().toLowerCase()

  switch (normalized) {
  case 'jpeg':
    return 'jpg'
  case 'png':
  case 'jpg':
  case 'gif':
  case 'webp':
  case 'svg':
  case 'bmp':
  case 'ico':
    return normalized
  default:
    return null
  }
}

function detectImageExtension(bytes: Uint8Array) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }

  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif'
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp'
  }

  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'ico'
  }

  const textHead = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase()
  if (textHead.startsWith('<svg') || (textHead.startsWith('<?xml') && textHead.includes('<svg'))) {
    return 'svg'
  }

  return null
}

function getImageExtension(path: string, bytes: Uint8Array) {
  return detectImageExtension(bytes) || getPathExtension(path) || 'jpg'
}

function getImageMimeType(extension: string) {
  switch (extension) {
  case 'jpg':
    return 'image/jpeg'
  case 'webp':
    return 'image/webp'
  case 'gif':
    return 'image/gif'
  case 'svg':
    return 'image/svg+xml'
  case 'bmp':
    return 'image/bmp'
  case 'ico':
    return 'image/x-icon'
  default:
    return 'image/png'
  }
}

export function ControlImage() {
  const t = useTranslations();
  const { primaryModel, enableImageRecognition } = useSettingStore()
  const { addQueue, setQueue, removeQueue } = useMarkStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isMobile = isMobileDevice()
  const completeRecord = useRecordCompletion()

  const handleSelectImages = useCallback(() => {
    selectImages()
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-image', handleSelectImages)
    return () => {
      emitter.off('toolbar-shortcut-image', handleSelectImages)
    }
  }, [handleSelectImages])

  async function selectImages() {
    try {
      if (isMobile) {
        fileInputRef.current?.removeAttribute('capture')
        fileInputRef.current?.click()
        return
      }

      const filePaths = await open({
        multiple: true,
        directory: false,
        filters: [{
          name: 'Image',
          extensions: ['png', 'jpeg', 'jpg', 'gif', 'webp', 'bmp']
        }]
      });
      if (!filePaths) return

      const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
      for (const path of paths) {
        await upload(path)
      }
    } catch (error) {
      if (isPickerCancelError(error)) {
        return
      }

      if (isMobile && !isPickerCancelError(error)) {
        console.warn('Native image picker failed, falling back to file input:', error)
        fileInputRef.current?.click()
        return
      }
      console.error('Error in selectImages:', error)
    }
  }

  // 处理移动端文件选择
  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = event.target.files
      if (!files || files.length === 0) {
        return
      }
      
      for (let i = 0; i < files.length; i++) {
        await uploadMobileFile(files[i])
      }
      
      // 重置 input
      event.target.value = ''
    } catch (error) {
      console.error('Error in handleFileInputChange:', error)
    }
  }

  // 移动端文件上传
  async function uploadMobileFile(file: File) {
    const queueId = uuid()
    const tagId = await getDefaultRecordSaveTagId()
    
    try {
      addQueue({ queueId, tagId, progress: t('record.mark.progress.cacheImage'), type: 'image', startTime: Date.now() })
      
      const fileData = new Uint8Array(await file.arrayBuffer())
      const ext = getImageExtension(file.name, fileData)
      const filename = `${queueId}.${ext}`
      const cachedFile = new File([fileData], filename, { type: getImageMimeType(ext) })
      
      const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
      if (!isImageFolderExists) {
        await mkdir('image', { baseDir: BaseDirectory.AppData})
      }
      
      await writeFile(`image/${filename}`, fileData, { baseDir: BaseDirectory.AppData })
      
      let content = ''
      let desc = ''
      
      // Skip image recognition if disabled
      if (!enableImageRecognition) {
        setQueue(queueId, { progress: t('record.mark.progress.save') });
        content = ''
        desc = ''
      } else {
        const result = await recognizeImageWithFallback({
          imagePath: `image/${filename}`,
          base64: bytesToDataUrl(fileData, ext),
          shouldGenerateDescription: Boolean(primaryModel),
          onProgress: (stage) => {
            setQueue(queueId, {
              progress: getImageRecognitionProgressText(t, stage),
            })
          },
        })
        content = result.content
        desc = result.desc
      }
      
      const mark: Partial<Mark> = {
        tagId,
        type: 'image',
        content,
        url: filename,
        desc,
      }
      
      // 尝试上传图片到图床（如果配置了图床）
      try {
        const url = await uploadImage(cachedFile)
        if (url) {
          setQueue(queueId, { progress: t('record.mark.progress.uploadImage') });
          mark.url = url
        }
      } catch (uploadError) {
        console.error('Failed to upload to image hosting:', uploadError)
        // 继续使用本地文件
      }
      
      const result = await insertMark(mark)
      removeQueue(queueId)
      const markId = Number(result.lastInsertId || 0) || null
      await completeRecord({
        markId,
        tagId,
        typeLabel: t('record.mark.type.image'),
      })
    } catch (error) {
      console.error('Error in uploadMobileFile:', error)
      removeQueue(queueId)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }

  async function upload(path: string) {
    const queueId = uuid()
    const tagId = await getDefaultRecordSaveTagId()
    try {
      addQueue({ queueId, tagId, progress: t('record.mark.progress.cacheImage'), type: 'image', startTime: Date.now() })
      const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
      if (!isImageFolderExists) {
        await mkdir('image', { baseDir: BaseDirectory.AppData})
      }
      const fileData = await readFile(path)
      const ext = getImageExtension(path, fileData)
      const filename = `${queueId}.${ext}`
      await writeFile(`image/${filename}`, fileData, { baseDir: BaseDirectory.AppData })
      let content = ''
      let desc = ''
      
      // Skip image recognition if disabled
      if (!enableImageRecognition) {
        setQueue(queueId, { progress: t('record.mark.progress.save') });
        content = ''
        desc = ''
      } else {
        const result = await recognizeImageWithFallback({
          imagePath: `image/${filename}`,
          base64: bytesToDataUrl(fileData, ext),
          shouldGenerateDescription: Boolean(primaryModel),
          onProgress: (stage) => {
            setQueue(queueId, {
              progress: getImageRecognitionProgressText(t, stage),
            })
          },
        })
        content = result.content
        desc = result.desc
      }
      
      const mark: Partial<Mark> = {
        tagId,
        type: 'image',
        content,
        url: filename,
        desc,
      }
      
      // 尝试上传图片到图床（如果配置了图床）
      const file = new File([fileData], filename, { type: getImageMimeType(ext) })
      try {
        const url = await uploadImage(file)
        if (url) {
          setQueue(queueId, { progress: t('record.mark.progress.uploadImage') });
          mark.url = url
        }
      } catch (uploadError) {
        console.error('Failed to upload to image hosting:', uploadError)
        toast({
          title: t('record.capture.imageUploadFallback'),
          description: t('record.capture.imageUploadFallbackDescription'),
        })
      }
      
      const result = await insertMark(mark)
      removeQueue(queueId)
      const markId = Number(result.lastInsertId || 0) || null
      await completeRecord({
        markId,
        tagId,
        typeLabel: t('record.mark.type.image'),
      })
    } catch (error) {
      console.error('Error in upload:', error)
      removeQueue(queueId)
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      {/* 移动端文件选择 */}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
      <TooltipButton icon={<ImagePlus />} tooltipText={t('record.mark.type.image')} onClick={selectImages} />
    </>
  )
}
