'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft, Plus, Upload, Settings2, Trash2, Check, X, MoreVertical, Pencil } from 'lucide-react'
import { TavernPreset, getPresets, insertPreset, deletePreset, updatePreset } from '@/db/tavern'
import { CompletionPresetEditor } from './components/preset-editor'
import { PresetPreviewDialog } from './components/preset-preview-dialog'
import { createDefaultCompletionPreset, CompletionPresetData } from '@/lib/tavern/preset-types'
import { importSTPreset, parseSTPresetJSON } from '@/lib/tavern/preset-converter'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function PresetsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [presets, setPresets] = useState<TavernPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<TavernPreset | null>(null)
  const [editingPreset, setEditingPreset] = useState<TavernPreset | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TavernPreset | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewData, setPreviewData] = useState<{ name: string; data: CompletionPresetData } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadPresets()
  }, [])

  const loadPresets = async () => {
    const data = await getPresets()
    setPresets(data)
    // 如果有选中的预设，更新其数据
    if (selectedPreset) {
      const updated = data.find(p => p.id === selectedPreset.id)
      if (updated) {
        setSelectedPreset(updated)
      }
    }
  }

  const handleCreatePreset = async () => {
    const defaultData = createDefaultCompletionPreset()
    const id = await insertPreset({
      name: '新建预设',
      presetType: 'completion',
      data: JSON.stringify(defaultData),
      isDefault: false,
    })
    await loadPresets()
    const newPresets = await getPresets()
    const newPreset = newPresets.find(p => p.id === id)
    if (newPreset) {
      setSelectedPreset(newPreset)
    }
  }

  const handleDeletePreset = async () => {
    if (deleteTarget) {
      await deletePreset(deleteTarget.id)
      setDeleteTarget(null)
      if (selectedPreset?.id === deleteTarget.id) {
        setSelectedPreset(null)
      }
      if (editingPreset?.id === deleteTarget.id) {
        setEditingPreset(null)
      }
      await loadPresets()
      toast({ title: '已删除' })
    }
  }

  const handlePresetSaved = async () => {
    await loadPresets()
    toast({ title: '保存成功' })
  }

  // 开始重命名
  const handleStartRename = (preset: TavernPreset) => {
    setRenamingId(preset.id)
    setRenameValue(preset.name)
  }

  // 确认重命名
  const handleConfirmRename = async () => {
    if (renamingId && renameValue.trim()) {
      await updatePreset(renamingId, { name: renameValue.trim() })
      await loadPresets()
      toast({ title: '已重命名' })
    }
    setRenamingId(null)
    setRenameValue('')
  }

  // 取消重命名
  const handleCancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  // 导入 ST 预设 - 先预览再确认
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string
        const stPreset = parseSTPresetJSON(content)
        if (!stPreset) {
          toast({ title: '无效的预设文件', variant: 'destructive' })
          return
        }
        const importedData = importSTPreset(stPreset)
        const presetName = file.name.replace(/\.json$/i, '') || '导入的预设'
        // 显示预览对话框
        setPreviewData({ name: presetName, data: importedData })
        setPreviewOpen(true)
      } catch (error) {
        toast({ title: '导入失败: 文件格式错误', variant: 'destructive' })
        console.error('Import error:', error)
      }
    }
    reader.readAsText(file)
    // 重置 input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 确认导入预设
  const handleConfirmImport = async () => {
    if (!previewData) return
    try {
      const id = await insertPreset({
        name: previewData.name,
        presetType: 'completion',
        data: JSON.stringify(previewData.data),
        isDefault: false,
      })
      await loadPresets()
      const newPresets = await getPresets()
      const newPreset = newPresets.find(p => p.id === id)
      if (newPreset) {
        setSelectedPreset(newPreset)
      }
      toast({ title: '预设已导入' })
    } catch (error) {
      toast({ title: '导入失败', variant: 'destructive' })
    }
    setPreviewOpen(false)
    setPreviewData(null)
  }

  // 如果正在编辑预设，显示编辑器
  if (editingPreset) {
    return (
      <CompletionPresetEditor
        preset={editingPreset}
        onBack={() => {
          setEditingPreset(null)
          loadPresets()
        }}
        onSaved={handlePresetSaved}
        onDelete={() => setDeleteTarget(editingPreset)}
      />
    )
  }

  // 获取预设的简要信息
  const getPresetSummary = (preset: TavernPreset) => {
    try {
      const data = JSON.parse(preset.data) as CompletionPresetData
      return {
        maxContext: data.basic?.maxContext || 4096,
        maxResponse: data.basic?.maxResponse || 300,
        temperature: data.sampling?.temperature ?? 1,
        streaming: data.basic?.streaming ?? true,
      }
    } catch {
      return { maxContext: 4096, maxResponse: 300, temperature: 1, streaming: true }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">预设管理</h1>
          <p className="text-sm text-muted-foreground">配置提示词模板和生成参数</p>
        </div>
        <div className="flex gap-2">
          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            导入
          </Button>
          <Button onClick={handleCreatePreset}>
            <Plus className="h-4 w-4 mr-2" />
            新建
          </Button>
        </div>
      </div>

      {/* 两栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧预设列表 */}
        <div className="w-64 border-r border-border flex flex-col">
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={cn(
                    'group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors',
                    'hover:bg-accent/50',
                    selectedPreset?.id === preset.id && 'bg-accent'
                  )}
                  onClick={() => setSelectedPreset(preset)}
                >
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  {renamingId === preset.id ? (
                    <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleConfirmRename()
                          if (e.key === 'Escape') handleCancelRename()
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleConfirmRename}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelRename}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">{preset.name}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation()
                            handleStartRename(preset)
                          }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            重命名
                          </DropdownMenuItem>
                          {!preset.isDefault && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget(preset)
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              删除
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              ))}
              {presets.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无预设</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧预设信息 */}
        <div className="flex-1 p-6">
          {selectedPreset ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold">{selectedPreset.name}</h2>
                    {selectedPreset.isDefault && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600">
                        默认
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    更新于 {new Date(selectedPreset.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Button onClick={() => setEditingPreset(selectedPreset)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  编辑
                </Button>
              </div>

              {/* 预设摘要 */}
              {(() => {
                const summary = getPresetSummary(selectedPreset)
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border border-border">
                      <p className="text-sm text-muted-foreground">上下文长度</p>
                      <p className="text-2xl font-semibold">{summary.maxContext.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-lg border border-border">
                      <p className="text-sm text-muted-foreground">最大回复长度</p>
                      <p className="text-2xl font-semibold">{summary.maxResponse.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-lg border border-border">
                      <p className="text-sm text-muted-foreground">温度</p>
                      <p className="text-2xl font-semibold">{summary.temperature}</p>
                    </div>
                    <div className="p-4 rounded-lg border border-border">
                      <p className="text-sm text-muted-foreground">流式传输</p>
                      <p className="text-2xl font-semibold">{summary.streaming ? '开启' : '关闭'}</p>
                    </div>
                  </div>
                )
              })()}

              {/* 操作按钮 */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleStartRename(selectedPreset)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  重命名
                </Button>
                {!selectedPreset.isDefault && (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(selectedPreset)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    删除
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Settings2 className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg">选择一个预设查看详情</p>
              <p className="text-sm mt-1">或创建新的预设</p>
              <Button className="mt-4" onClick={handleCreatePreset}>
                <Plus className="h-4 w-4 mr-2" />
                创建预设
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除预设 &ldquo;{deleteTarget?.name}&rdquo; 吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePreset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 导入预览对话框 */}
      <PresetPreviewDialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open)
          if (!open) setPreviewData(null)
        }}
        presetName={previewData?.name || ''}
        presetData={previewData?.data || null}
        onConfirmImport={handleConfirmImport}
      />
    </div>
  )
}
