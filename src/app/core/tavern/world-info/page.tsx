'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { 
  ArrowLeft, Plus, BookOpen, Search, Settings2, 
  Download, Upload, Trash2, MoreVertical, SlidersHorizontal, Pencil
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { 
  TavernWorldInfo, 
  TavernWorldInfoEntry,
  getWorldInfos, 
  getWorldInfoEntries,
  deleteWorldInfo,
  insertWorldInfo,
  updateWorldInfo,
  insertWorldInfoEntry,
} from '@/db/tavern'
import { cn } from '@/lib/utils'
import { EntryEditor } from './entry-editor'
import { WorldInfoSettingsPanel } from './settings-panel'
import { BulkSelectPanel, executeBulkAction, BulkAction } from './bulk-operations'
import { importWorldInfoFromJson, exportWorldInfoToJson } from '@/lib/tavern/world-info-io'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useToast } from '@/hooks/use-toast'
import { useTavernWorldInfoStore } from '@/stores/tavern-world-info'

type TabType = 'global' | 'character'

export default function WorldInfoPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { init: initWorldInfoStore, scanConfig } = useTavernWorldInfoStore()
  
  const [worldInfos, setWorldInfos] = useState<TavernWorldInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('global')
  const [selectedWorldInfo, setSelectedWorldInfo] = useState<TavernWorldInfo | null>(null)
  const [entries, setEntries] = useState<TavernWorldInfoEntry[]>([])
  const [editingEntry, setEditingEntry] = useState<TavernWorldInfoEntry | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editWorldInfoOpen, setEditWorldInfoOpen] = useState(false)
  const [newWorldInfo, setNewWorldInfo] = useState({ name: '', description: '' })
  const [editingWorldInfo, setEditingWorldInfo] = useState<TavernWorldInfo | null>(null)

  useEffect(() => {
    loadWorldInfos()
    initWorldInfoStore()
  }, [])

  const loadWorldInfos = async () => {
    const data = await getWorldInfos()
    setWorldInfos(data)
  }

  const handleSelectWorldInfo = async (wi: TavernWorldInfo) => {
    setSelectedWorldInfo(wi)
    const data = await getWorldInfoEntries(wi.id)
    setEntries(data)
    // 清空选中状态
    setSelectedEntryIds(new Set())
    setBulkMode(false)
  }

  // 批量操作处理
  const handleBulkAction = async (action: BulkAction) => {
    if (!selectedWorldInfo || selectedEntryIds.size === 0) return
    
    const selectedEntries = entries.filter(e => selectedEntryIds.has(e.id))
    const success = await executeBulkAction(action, selectedEntries, selectedWorldInfo.id)
    
    if (success) {
      // 刷新条目列表
      const data = await getWorldInfoEntries(selectedWorldInfo.id)
      setEntries(data)
      // 清空选中
      setSelectedEntryIds(new Set())
      setBulkMode(false)
      toast({ description: '操作完成' })
    }
  }

  const handleEditEntry = (entry: TavernWorldInfoEntry) => {
    setEditingEntry(entry)
    setEditorOpen(true)
  }

  const handleEntrySaved = async () => {
    if (selectedWorldInfo) {
      const data = await getWorldInfoEntries(selectedWorldInfo.id)
      setEntries(data)
    }
  }

  // 导入世界书
  const handleImport = async () => {
    try {
      setImporting(true)
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: '世界书', extensions: ['json'] }],
      })

      if (!selected) return

      const filePath = typeof selected === 'string' ? selected : selected
      const content = await readTextFile(filePath)
      
      // 从文件名获取世界书名称
      const fileName = filePath.split(/[\\/]/).pop() || '导入的世界书'
      const name = fileName.replace(/\.json$/i, '')

      const result = await importWorldInfoFromJson(
        content,
        name,
        activeTab,
        null
      )

      if (result.success) {
        toast({ description: `导入成功：${result.entryCount} 个条目` })
        await loadWorldInfos()
      } else {
        toast({ description: `导入失败：${result.error}`, variant: 'destructive' })
      }
    } catch (error) {
      console.error('导入世界书失败:', error)
      toast({ description: '导入失败', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  // 导出世界书
  const handleExport = async (wi: TavernWorldInfo) => {
    try {
      const json = await exportWorldInfoToJson(wi.id)
      if (!json) {
        toast({ description: '导出失败', variant: 'destructive' })
        return
      }

      const filePath = await saveDialog({
        defaultPath: `${wi.name}.json`,
        filters: [{ name: '世界书', extensions: ['json'] }],
      })

      if (filePath) {
        await writeTextFile(filePath, json)
        toast({ description: '导出成功' })
      }
    } catch (error) {
      console.error('导出世界书失败:', error)
      toast({ description: '导出失败', variant: 'destructive' })
    }
  }

  // 删除世界书
  const handleDelete = async (wi: TavernWorldInfo) => {
    if (!confirm(`确定删除世界书 "${wi.name}" 吗？`)) return
    
    try {
      await deleteWorldInfo(wi.id)
      toast({ description: '删除成功' })
      if (selectedWorldInfo?.id === wi.id) {
        setSelectedWorldInfo(null)
        setEntries([])
      }
      await loadWorldInfos()
    } catch (error) {
      console.error('删除世界书失败:', error)
      toast({ description: '删除失败', variant: 'destructive' })
    }
  }

  // 新建世界书
  const handleCreate = async () => {
    if (!newWorldInfo.name.trim()) {
      toast({ description: '请输入世界书名称', variant: 'destructive' })
      return
    }
    
    try {
      const id = await insertWorldInfo({
        name: newWorldInfo.name.trim(),
        description: newWorldInfo.description.trim(),
        scope: activeTab,
        cardId: null,
        enabled: true,
      })
      toast({ description: '创建成功' })
      setCreateDialogOpen(false)
      setNewWorldInfo({ name: '', description: '' })
      await loadWorldInfos()
      // 选中新创建的世界书
      const newWi = (await getWorldInfos()).find(w => w.id === id)
      if (newWi) {
        handleSelectWorldInfo(newWi)
      }
    } catch (error) {
      console.error('创建世界书失败:', error)
      toast({ description: '创建失败', variant: 'destructive' })
    }
  }

  // 编辑世界书信息
  const handleEditWorldInfo = (wi: TavernWorldInfo) => {
    setEditingWorldInfo({ ...wi })
    setEditWorldInfoOpen(true)
  }

  // 保存世界书编辑
  const handleSaveWorldInfo = async () => {
    if (!editingWorldInfo) return
    
    try {
      await updateWorldInfo(editingWorldInfo.id, {
        name: editingWorldInfo.name,
        description: editingWorldInfo.description,
        enabled: editingWorldInfo.enabled,
      })
      toast({ description: '保存成功' })
      setEditWorldInfoOpen(false)
      await loadWorldInfos()
      // 更新选中的世界书
      if (selectedWorldInfo?.id === editingWorldInfo.id) {
        setSelectedWorldInfo(editingWorldInfo)
      }
    } catch (error) {
      console.error('保存世界书失败:', error)
      toast({ description: '保存失败', variant: 'destructive' })
    }
  }

  // 新建条目
  const handleCreateEntry = async () => {
    if (!selectedWorldInfo) return
    
    try {
      const maxUid = entries.reduce((max, e) => Math.max(max, e.uid), 0)
      await insertWorldInfoEntry({
        worldInfoId: selectedWorldInfo.id,
        uid: maxUid + 1,
        keys: '[]',
        secondaryKeys: '[]',
        content: '',
        comment: '新条目',
        enabled: true,
        constant: false,
        selective: false,
        selectiveLogic: 0,
        order: entries.length,
        position: 0,
        depth: 4,
        probability: 100,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: false,
        matchWholeWords: false,
        automationId: '',
        excludeRecursion: false,
        preventRecursion: false,
        vectorized: false,
        useRegex: false,
        role: 0,
        useProbability: true,
        displayIndex: entries.length,
        delayUntilRecursion: false,
        sticky: null,
        cooldown: null,
        delay: null,
      })
      toast({ description: '条目已创建' })
      // 刷新条目列表
      const data = await getWorldInfoEntries(selectedWorldInfo.id)
      setEntries(data)
      // 打开编辑器编辑新条目
      const newEntry = data.find(e => e.uid === maxUid + 1)
      if (newEntry) {
        setEditingEntry(newEntry)
        setEditorOpen(true)
      }
    } catch (error) {
      console.error('创建条目失败:', error)
      toast({ description: '创建失败', variant: 'destructive' })
    }
  }

  const filteredWorldInfos = worldInfos.filter(wi =>
    wi.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    wi.scope === activeTab
  )

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">世界书</h1>
          <p className="text-sm text-muted-foreground">管理全局和角色绑定的知识库</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={handleImport} disabled={importing}>
          <Upload className="h-4 w-4 mr-2" />
          导入
        </Button>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          新建
        </Button>
      </div>

      {/* Tab 切换 */}
      <div className="px-4 pt-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)}>
          <TabsList className="w-full">
            <TabsTrigger value="global" className="flex-1">全局世界书</TabsTrigger>
            <TabsTrigger value="character" className="flex-1">角色世界书</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 双栏布局 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧：世界书列表 */}
        <div className="w-64 border-r border-border flex flex-col">
          {/* 搜索 */}
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* 列表 */}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredWorldInfos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <BookOpen className="h-10 w-10 mb-2 opacity-50" />
                  <p className="text-sm">暂无世界书</p>
                  <p className="text-xs mt-1">点击导入或新建</p>
                </div>
              ) : (
                filteredWorldInfos.map((wi) => (
                  <div
                    key={wi.id}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-lg cursor-pointer group",
                      "hover:bg-accent/50 transition-colors",
                      selectedWorldInfo?.id === wi.id && "bg-accent"
                    )}
                    onClick={() => handleSelectWorldInfo(wi)}
                  >
                    <BookOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className={cn(
                      "flex-1 text-sm truncate",
                      !wi.enabled && "opacity-50"
                    )}>
                      {wi.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExport(wi)}>
                          <Download className="h-4 w-4 mr-2" />
                          导出
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => handleDelete(wi)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧：条目管理 */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedWorldInfo ? (
            <>
              {/* 世界书信息 */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium">{selectedWorldInfo.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorldInfo.description || '暂无描述'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedWorldInfo.enabled ? 'default' : 'secondary'}>
                      {selectedWorldInfo.enabled ? '启用' : '禁用'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {entries.length} 个条目
                    </span>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleEditWorldInfo(selectedWorldInfo)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" onClick={handleCreateEntry}>
                      <Plus className="h-4 w-4 mr-1" />
                      新建条目
                    </Button>
                  </div>
                </div>
              </div>

              {/* 批量操作面板 */}
              {entries.length > 0 && (
                <BulkSelectPanel
                  entries={entries}
                  selectedIds={selectedEntryIds}
                  onSelectionChange={setSelectedEntryIds}
                  onBulkAction={handleBulkAction}
                  bulkMode={bulkMode}
                  onBulkModeChange={setBulkMode}
                />
              )}

              {/* 条目列表 */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {entries.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Settings2 className="h-10 w-10 mb-2 opacity-50" />
                        <p className="text-sm">暂无条目</p>
                      </CardContent>
                    </Card>
                  ) : (
                    entries.map((entry) => {
                      const keys: string[] = JSON.parse(entry.keys || '[]')
                      const isSelected = selectedEntryIds.has(entry.id)
                      return (
                        <div 
                          key={entry.id}
                          className={cn(
                            "p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors",
                            !entry.enabled && "opacity-50",
                            isSelected && "ring-2 ring-primary bg-primary/5"
                          )}
                          onClick={() => {
                            if (bulkMode) {
                              // 批量模式：切换选中状态
                              const newSelected = new Set(selectedEntryIds)
                              if (isSelected) {
                                newSelected.delete(entry.id)
                              } else {
                                newSelected.add(entry.id)
                              }
                              setSelectedEntryIds(newSelected)
                            } else {
                              // 普通模式：打开编辑器
                              handleEditEntry(entry)
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            {bulkMode && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="mt-1 h-4 w-4 rounded border-gray-300"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {entry.comment && (
                                  <span className="text-sm font-medium">{entry.comment}</span>
                                )}
                                {keys.slice(0, 3).map((key, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {key}
                                  </Badge>
                                ))}
                                {keys.length > 3 && (
                                  <span className="text-xs text-muted-foreground">+{keys.length - 3}</span>
                                )}
                                {entry.constant && (
                                  <Badge variant="default" className="text-xs">常驻</Badge>
                                )}
                                {entry.useRegex && (
                                  <Badge variant="outline" className="text-xs">正则</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {entry.content || '无内容'}
                              </p>
                            </div>
                            {!bulkMode && (
                              <Settings2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <BookOpen className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p>选择一个世界书查看条目</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 条目编辑器 */}
      <EntryEditor
        entry={editingEntry}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={handleEntrySaved}
      />

      {/* 扫描设置面板 */}
      <WorldInfoSettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {/* 新建世界书对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建世界书</DialogTitle>
            <DialogDescription>
              创建一个新的{activeTab === 'global' ? '全局' : '角色'}世界书
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={newWorldInfo.name}
                onChange={(e) => setNewWorldInfo({ ...newWorldInfo, name: e.target.value })}
                placeholder="输入世界书名称"
              />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Textarea
                value={newWorldInfo.description}
                onChange={(e) => setNewWorldInfo({ ...newWorldInfo, description: e.target.value })}
                placeholder="输入世界书描述（可选）"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑世界书对话框 */}
      <Dialog open={editWorldInfoOpen} onOpenChange={setEditWorldInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑世界书</DialogTitle>
            <DialogDescription>
              修改世界书的基本信息
            </DialogDescription>
          </DialogHeader>
          {editingWorldInfo && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>名称</Label>
                <Input
                  value={editingWorldInfo.name}
                  onChange={(e) => setEditingWorldInfo({ ...editingWorldInfo, name: e.target.value })}
                  placeholder="输入世界书名称"
                />
              </div>
              <div className="space-y-2">
                <Label>描述</Label>
                <Textarea
                  value={editingWorldInfo.description}
                  onChange={(e) => setEditingWorldInfo({ ...editingWorldInfo, description: e.target.value })}
                  placeholder="输入世界书描述（可选）"
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch
                  checked={editingWorldInfo.enabled}
                  onCheckedChange={(checked) => setEditingWorldInfo({ ...editingWorldInfo, enabled: checked })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditWorldInfoOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveWorldInfo}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
