import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus } from "lucide-react"
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from "@tauri-apps/plugin-fs";
import useTagStore from "@/stores/tag";
import useMarkStore from "@/stores/mark";
import { insertMark } from "@/db/marks";
import { useEffect, useCallback } from 'react'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'
import { handleRecordComplete } from '@/lib/record-navigation'
import { extractTextFromPDF } from '@/lib/pdf'
import { v4 as uuid } from 'uuid'

// 常见的代码格式
const codeExtensions = [
  // Web开发
  'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'php', 'mjs', 'mts',
  // 编程语言
  'py', 'java', 'cpp', 'c', 'cs', 'go', 'rb', 'rs', 'swift', 'kt', 'scala', 'dart', 'lua', 'r',
  // 标记/配置
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'graphql', 'sql',
  // Shell脚本
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  // 其他
  'asm', 'pl', 'clj', 'ex', 'elm', 'f90', 'hs', 'jl', 'swift', 'ml'
];
const textFileExtensions = ['txt', 'md', 'csv'];
const pdfExtensions = ['pdf'];
const fileExtensions: string[] = []

export function ControlFile() {
  const t = useTranslations();
  const router = useRouter();
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  const handleSelectFile = useCallback(() => {
    selectFile()
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-file', handleSelectFile)
    return () => {
      emitter.off('toolbar-shortcut-file', handleSelectFile)
    }
  }, [handleSelectFile])

  async function selectFile() {
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [{
        name: 'files',
        extensions: [...textFileExtensions, ...fileExtensions, ...codeExtensions, ...pdfExtensions]
      }]
    });
    if (!filePath) return
    
    // 记录完成后的导航处理（桌面端切换tab，移动端跳转页面）
    handleRecordComplete(router)
    
    await readFileByPath(filePath)
  }

  async function readFileByPath(path: string) {
    const ext = path.substring(path.lastIndexOf('.') + 1)
    // 提取文件名（不含路径）
    const fileName = path.split('/').pop() || path.split('\\').pop() || path
    // 构建描述：文件名
    const desc = fileName
    let content = ''

    // 处理 PDF 文件
    if (pdfExtensions.includes(ext)) {
      const queueId = uuid()
      try {
        addQueue({ queueId, tagId: currentTagId!, progress: t('record.mark.progress.cacheFile'), type: 'file', startTime: Date.now() })
        content = await extractTextFromPDF(path, (progress) => {
          setQueue(queueId, { progress })
        })
        setQueue(queueId, { progress: t('record.mark.progress.save') })
      } catch (error) {
        console.error('PDF extraction failed:', error)
        content = 'PDF 文本提取失败'
      }
      removeQueue(queueId)

      // 将完整路径存储在 url 字段，用于点击时打开文件夹
      await insertMark({
        tagId: currentTagId,
        type: 'file',
        desc: desc,
        content: content,
        url: path
      })
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
      return
    }
    // 处理文本文件和代码文件
    else if ([...textFileExtensions, ...codeExtensions].includes(ext)) {
      content = await readTextFile(path)
      content = content.replace(/'/g, '')
    }
    // 不支持的文件类型
    else {
      return
    }

    // 将完整路径存储在 url 字段，用于点击时打开文件夹
    await insertMark({
      tagId: currentTagId,
      type: 'file',
      desc: desc,
      content: content,
      url: path
    })
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  return (
    <TooltipButton icon={<FilePlus />} tooltipText={t('record.mark.type.file')} onClick={selectFile} />
  )
}