'use client'

import { useState, useEffect } from 'react'
import { Editor } from '@tiptap/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { compareFileVersions, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import emitter from '@/lib/emitter'

interface ConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeFilePath: string | null
  editor: Editor
  onResolved: () => void
}

// 简单的 diff 计算
function computeDiff(oldText: string, newText: string): { type: 'equal' | 'add' | 'remove', text: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: 'equal' | 'add' | 'remove', text: string }[] = []

  // 简单的行对比
  const maxLen = Math.max(oldLines.length, newLines.length)
  let oldIdx = 0
  let newIdx = 0

  while (oldIdx < maxLen || newIdx < maxLen) {
    const oldLine = oldLines[oldIdx]
    const newLine = newLines[newIdx]

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        result.push({ type: 'equal', text: oldLine })
      }
      oldIdx++
      newIdx++
    } else if (oldLine === undefined) {
      // 新增行
      if (newLine !== undefined) {
        result.push({ type: 'add', text: newLine })
      }
      newIdx++
    } else if (newLine === undefined) {
      // 删除行
      result.push({ type: 'remove', text: oldLine })
      oldIdx++
    } else {
      // 不相同，认为是修改
      result.push({ type: 'remove', text: oldLine })
      result.push({ type: 'add', text: newLine })
      oldIdx++
      newIdx++
    }
  }

  return result
}

export function ConflictDialog({
  open,
  onOpenChange,
  activeFilePath,
  editor,
  onResolved,
}: ConflictDialogProps) {
  const [localContent, setLocalContent] = useState('')
  const [remoteContent, setRemoteContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [diff, setDiff] = useState<{ type: 'equal' | 'add' | 'remove', text: string }[]>([])

  // 当对话框打开时，获取本地和远程内容
  useEffect(() => {
    if (!open || !activeFilePath) return

    const fetchContents = async () => {
      try {
        // 获取远程内容
        const remote = await pullRemoteFile(activeFilePath)
        setRemoteContent(remote)

        // 获取本地内容（从编辑器）
        const local = editor.getMarkdown()
        setLocalContent(local)

        // 计算 diff
        const diffResult = computeDiff(local, remote)
        setDiff(diffResult)
      } catch (error) {
        console.error('Failed to fetch contents for conflict:', error)
      }
    }

    fetchContents()
  }, [open, activeFilePath, editor])

  const handleKeepLocal = async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      // 保留本地，更新同步时间
      await updateFileSyncTime(activeFilePath)
      // 触发事件
      emitter.emit('sync-pulled', { path: activeFilePath })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to keep local:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeepRemote = async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      // 使用远程内容覆盖本地
      await saveLocalFile(activeFilePath, remoteContent)
      editor.commands.setContent(remoteContent, { contentType: 'markdown' })
      await updateFileSyncTime(activeFilePath)
      emitter.emit('sync-pulled', { path: activeFilePath })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to keep remote:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 统计变化
  const addCount = diff.filter(d => d.type === 'add').length
  const removeCount = diff.filter(d => d.type === 'remove').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>文件冲突</DialogTitle>
          <DialogDescription>
            检测到远程文件与本地文件存在冲突。请选择要保留的版本。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-[300px]">
          {/* 本地版本 */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              本地版本
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {localContent || '加载中...'}
            </div>
          </div>

          {/* 远程版本 */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              远程版本
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {remoteContent || '加载中...'}
            </div>
          </div>
        </div>

        {/* 变化统计 */}
        <div className="text-sm text-muted-foreground">
          <span className="text-green-500">+{addCount} 新增</span>
          {' / '}
          <span className="text-red-500">-{removeCount} 删除</span>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleKeepLocal}
            disabled={isLoading}
          >
            保留本地
          </Button>
          <Button
            onClick={handleKeepRemote}
            disabled={isLoading}
          >
            保留远程
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
