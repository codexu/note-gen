import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from "@/components/ui/enhanced-context-menu"
import { Switch } from "@/components/ui/switch"
import { Database, Trash2 } from "lucide-react"
import { Store } from '@tauri-apps/plugin-store'
import { toast } from "@/hooks/use-toast"
import useArticleStore, { DirTree } from "@/stores/article"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { computedParentPath } from "@/lib/path"
import useVectorStore from "@/stores/vector"

interface VectorKnowledgeMenuProps {
  item: DirTree
  hasVector: boolean
  onVectorUpdated: () => void
}

export function VectorKnowledgeMenu({ item, hasVector, onVectorUpdated }: VectorKnowledgeMenuProps) {
  const t = useTranslations('article.file')
  const { clearFileVector, checkFileVectorIndexed, setVectorCalcStatus } = useArticleStore()
  const { isAutoVectorEnabled } = useVectorStore()
  const [autoCalcEnabled, setAutoCalcEnabled] = useState(true)
  const [excludeFromKB, setExcludeFromKB] = useState(false)
  const filePath = computedParentPath(item)

  // 加载向量配置状态
  useEffect(() => {
    async function loadVectorSettings() {
      const store = await Store.load('store.json')
      const disabledFiles = await store.get<string[]>('vectorAutoCalcDisabled') || []
      const excludedFiles = await store.get<string[]>('vectorExcludedFiles') || []
      setAutoCalcEnabled(!disabledFiles.includes(filePath))
      setExcludeFromKB(excludedFiles.includes(filePath))
    }
    loadVectorSettings()
  }, [item])

  async function handleVectorCalculation() {
    if (!item.isFile) return

    try {
      // 设置为计算中状态
      setVectorCalcStatus(filePath, 'calculating')

      // 获取完整文件路径
      const { getFilePathOptions } = await import('@/lib/workspace')
      const pathOptions = await getFilePathOptions(filePath)

      let content = ''
      if (pathOptions.baseDir) {
        content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      } else {
        content = await readTextFile(pathOptions.path)
      }

      // 直接调用 RAG 库计算向量，与文件夹批量计算保持一致
      const { processMarkdownFile } = await import('@/lib/rag')
      await processMarkdownFile(filePath, content)

      // 更新向量索引状态
      await checkFileVectorIndexed(filePath)
      onVectorUpdated()

      // 设置为完成状态
      setVectorCalcStatus(filePath, 'completed')

      toast({ title: hasVector ? t('context.vectorCalculated') : t('context.vectorCalcCompleted') })
    } catch (error) {
      console.error('向量计算失败:', error)
      // 失败时恢复为空闲状态
      setVectorCalcStatus(filePath, 'idle')
      toast({ title: t('context.vectorCalcFailed'), variant: 'destructive' })
    }
  }

  async function handleDeleteVector() {
    if (!item.isFile) return

    try {
      await clearFileVector(filePath)
      onVectorUpdated()
      toast({ title: t('context.vectorDeleted') })
    } catch (error) {
      console.error('删除向量失败:', error)
      toast({ title: t('context.vectorDeleteFailed'), variant: 'destructive' })
    }
  }

  async function handleToggleAutoCalc(checked: boolean) {
    const store = await Store.load('store.json')
    const disabledFiles = await store.get<string[]>('vectorAutoCalcDisabled') || []

    if (checked) {
      const index = disabledFiles.indexOf(filePath)
      if (index > -1) {
        disabledFiles.splice(index, 1)
      }
    } else {
      if (!disabledFiles.includes(filePath)) {
        disabledFiles.push(filePath)
      }
    }

    await store.set('vectorAutoCalcDisabled', disabledFiles)
    setAutoCalcEnabled(checked)
  }

  async function handleToggleExcludeFromKB(checked: boolean) {
    const store = await Store.load('store.json')
    const excludedFiles = await store.get<string[]>('vectorExcludedFiles') || []

    if (checked) {
      const index = excludedFiles.indexOf(filePath)
      if (index > -1) {
        excludedFiles.splice(index, 1)
      }
    } else {
      if (!excludedFiles.includes(filePath)) {
        excludedFiles.push(filePath)
      }
      if (hasVector) {
        await clearFileVector(filePath)
        onVectorUpdated()
      }
    }

    await store.set('vectorExcludedFiles', excludedFiles)
    setExcludeFromKB(!checked)
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger inset menuType="file">
        <Database className="mr-2 h-4 w-4" />
        {t('context.knowledgeBase')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem inset onClick={handleVectorCalculation} menuType="file">
          <Database className="mr-2 h-4 w-4" />
          {hasVector ? t('context.updateVectors') : t('context.calculateVectors')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasVector} inset onClick={(e) => { e.stopPropagation(); handleDeleteVector(); }} menuType="file" className="text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          {t('context.deleteVectors')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5 text-sm" onClick={(e) => e.stopPropagation()}>
          <span>{t('context.autoVectorCalc')}</span>
          <Switch
            checked={autoCalcEnabled}
            onCheckedChange={handleToggleAutoCalc}
            disabled={!isAutoVectorEnabled}
            className="ml-4"
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm" onClick={(e) => e.stopPropagation()}>
          <span>{t('context.includeInKBFile')}</span>
          <Switch
            checked={!excludeFromKB}
            onCheckedChange={handleToggleExcludeFromKB}
            className="ml-4"
          />
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
