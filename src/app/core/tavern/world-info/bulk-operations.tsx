'use client'

import { useState, useCallback } from 'react'
import {
  TavernWorldInfo,
  TavernWorldInfoEntry,
  getWorldInfoEntries,
  updateWorldInfoEntry,
  deleteWorldInfoEntry,
  insertWorldInfoEntry,
} from '@/db/tavern'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import {
  Copy,
  Trash2,
  Edit,
  CheckSquare,
  Square,
  Download,
  Upload,
  Merge,
  Split,
  Replace,
} from 'lucide-react'
import { detectCircularDependencies, validateReferenceSyntax } from '@/lib/tavern/wi-references'

// ============ 批量选择面板 ============
interface BulkSelectPanelProps {
  entries: TavernWorldInfoEntry[]
  selectedIds: Set<number>
  onSelectionChange: (ids: Set<number>) => void
  onBulkAction: (action: BulkAction) => void
  bulkMode: boolean
  onBulkModeChange: (bulkMode: boolean) => void
}

export type BulkAction = 
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'export' }
  | { type: 'set-field'; field: string; value: any }
  | { type: 'find-replace'; find: string; replace: string; inContent: boolean; inKeys: boolean }

export function BulkSelectPanel({
  entries,
  selectedIds,
  onSelectionChange,
  onBulkAction,
  bulkMode,
  onBulkModeChange,
}: BulkSelectPanelProps) {
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)
  const [showFieldDialog, setShowFieldDialog] = useState(false)
  
  const handleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(entries.map(e => e.id)))
    }
  }
  
  const handleSelectEnabled = () => {
    onSelectionChange(new Set(entries.filter(e => e.enabled).map(e => e.id)))
  }
  
  const handleSelectDisabled = () => {
    onSelectionChange(new Set(entries.filter(e => !e.enabled).map(e => e.id)))
  }
  
  const hasSelection = selectedIds.size > 0

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border">
      <Button
        variant={bulkMode ? 'default' : 'outline'}
        size="sm"
        onClick={() => {
          const next = !bulkMode
          onBulkModeChange(next)
          if (!next) {
            onSelectionChange(new Set())
          }
        }}
      >
        {bulkMode ? '退出批量' : '批量选择'}
      </Button>

      {hasSelection ? (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === entries.length}
              onCheckedChange={handleSelectAll}
            />
            <span className="text-sm font-medium">
              已选 {selectedIds.size} / {entries.length}
            </span>
          </div>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectEnabled}
          >
            选择已启用
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectDisabled}
          >
            选择已禁用
          </Button>

          <div className="h-4 w-px bg-border mx-2" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkAction({ type: 'enable' })}
          >
            启用
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkAction({ type: 'disable' })}
          >
            禁用
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkAction({ type: 'duplicate' })}
          >
            <Copy className="h-4 w-4 mr-1" />
            复制
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReplaceDialog(true)}
          >
            <Replace className="h-4 w-4 mr-1" />
            替换
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFieldDialog(true)}
          >
            <Edit className="h-4 w-4 mr-1" />
            批量编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkAction({ type: 'export' })}
          >
            <Download className="h-4 w-4 mr-1" />
            导出选中
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => {
              if (confirm(`确定删除选中的 ${selectedIds.size} 个条目？`)) {
                onBulkAction({ type: 'delete' })
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            删除
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">
            {bulkMode ? '点击条目进行选择' : '开启批量模式后可多选条目'}
          </span>
          <div className="flex-1" />
        </>
      )}
      
      {/* 查找替换对话框 */}
      {showReplaceDialog && (
        <FindReplaceDialog
          open={showReplaceDialog}
          onOpenChange={setShowReplaceDialog}
          onSubmit={(find, replace, inContent, inKeys) => {
            onBulkAction({ type: 'find-replace', find, replace, inContent, inKeys })
            setShowReplaceDialog(false)
          }}
        />
      )}
      
      {/* 批量编辑字段对话框 */}
      {showFieldDialog && (
        <BulkFieldDialog
          open={showFieldDialog}
          onOpenChange={setShowFieldDialog}
          onSubmit={(field, value) => {
            onBulkAction({ type: 'set-field', field, value })
            setShowFieldDialog(false)
          }}
        />
      )}
    </div>
  )
}

// ============ 查找替换对话框 ============
interface FindReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (find: string, replace: string, inContent: boolean, inKeys: boolean) => void
}

function FindReplaceDialog({ open, onOpenChange, onSubmit }: FindReplaceDialogProps) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [inContent, setInContent] = useState(true)
  const [inKeys, setInKeys] = useState(false)
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>查找与替换</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>查找</Label>
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="要查找的文本"
            />
          </div>
          <div className="space-y-2">
            <Label>替换为</Label>
            <Input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="替换后的文本"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={inContent}
                onCheckedChange={(c) => setInContent(!!c)}
              />
              <Label>在内容中查找</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={inKeys}
                onCheckedChange={(c) => setInKeys(!!c)}
              />
              <Label>在关键词中查找</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button 
            onClick={() => onSubmit(find, replace, inContent, inKeys)}
            disabled={!find}
          >
            替换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 批量编辑字段对话框 ============
interface BulkFieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (field: string, value: any) => void
}

function BulkFieldDialog({ open, onOpenChange, onSubmit }: BulkFieldDialogProps) {
  const [field, setField] = useState('position')
  const [value, setValue] = useState<any>(0)
  
  const fields = [
    { key: 'position', label: '注入位置', type: 'select', options: [
      { value: 0, label: '角色描述之前' },
      { value: 1, label: '角色描述之后' },
      { value: 4, label: '系统提示词之后' },
      { value: 6, label: '深度位置' },
    ]},
    { key: 'depth', label: '深度', type: 'number' },
    { key: 'order', label: '排序', type: 'number' },
    { key: 'probability', label: '概率', type: 'number' },
    { key: 'group', label: '分组', type: 'text' },
    { key: 'groupWeight', label: '分组权重', type: 'number' },
    { key: 'selective', label: '选择性激活', type: 'boolean' },
    { key: 'constant', label: '常驻激活', type: 'boolean' },
    { key: 'caseSensitive', label: '大小写敏感', type: 'boolean' },
    { key: 'matchWholeWords', label: '全词匹配', type: 'boolean' },
  ]
  
  const selectedField = fields.find(f => f.key === field)
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量编辑字段</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>字段</Label>
            <Select value={field} onValueChange={setField}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map(f => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>值</Label>
            {selectedField?.type === 'select' && (
              <Select value={String(value)} onValueChange={(v) => setValue(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedField.options?.map(o => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedField?.type === 'number' && (
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
              />
            )}
            {selectedField?.type === 'text' && (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            {selectedField?.type === 'boolean' && (
              <Switch
                checked={value}
                onCheckedChange={setValue}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => onSubmit(field, value)}>
            应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 批量操作执行器 ============
export async function executeBulkAction(
  action: BulkAction,
  selectedEntries: TavernWorldInfoEntry[],
  worldInfoId: number
): Promise<{ success: boolean; message: string; affectedCount: number }> {
  let affectedCount = 0
  
  try {
    switch (action.type) {
      case 'enable':
        for (const entry of selectedEntries) {
          await updateWorldInfoEntry(entry.id, { enabled: true })
          affectedCount++
        }
        return { success: true, message: `已启用 ${affectedCount} 个条目`, affectedCount }
        
      case 'disable':
        for (const entry of selectedEntries) {
          await updateWorldInfoEntry(entry.id, { enabled: false })
          affectedCount++
        }
        return { success: true, message: `已禁用 ${affectedCount} 个条目`, affectedCount }
        
      case 'delete':
        for (const entry of selectedEntries) {
          await deleteWorldInfoEntry(entry.id)
          affectedCount++
        }
        return { success: true, message: `已删除 ${affectedCount} 个条目`, affectedCount }
        
      case 'duplicate':
        const allEntries = await getWorldInfoEntries(worldInfoId)
        let maxUid = allEntries.reduce((max, e) => Math.max(max, e.uid), 0)
        
        for (const entry of selectedEntries) {
          maxUid++
          const { id: _id, createdAt: _createdAt, ...entryData } = entry
          await insertWorldInfoEntry({
            ...entryData,
            uid: maxUid,
            comment: `${entry.comment || ''} (副本)`,
          })
          affectedCount++
        }
        return { success: true, message: `已复制 ${affectedCount} 个条目`, affectedCount }
        
      case 'set-field':
        for (const entry of selectedEntries) {
          await updateWorldInfoEntry(entry.id, { [action.field]: action.value })
          affectedCount++
        }
        return { success: true, message: `已更新 ${affectedCount} 个条目`, affectedCount }
        
      case 'find-replace':
        for (const entry of selectedEntries) {
          const updates: Partial<TavernWorldInfoEntry> = {}
          
          if (action.inContent && entry.content.includes(action.find)) {
            updates.content = entry.content.replaceAll(action.find, action.replace)
          }
          
          if (action.inKeys) {
            try {
              const keys = JSON.parse(entry.keys || '[]') as string[]
              const newKeys = keys.map(k => k.replaceAll(action.find, action.replace))
              if (JSON.stringify(keys) !== JSON.stringify(newKeys)) {
                updates.keys = JSON.stringify(newKeys)
              }
            } catch {}
          }
          
          if (Object.keys(updates).length > 0) {
            await updateWorldInfoEntry(entry.id, updates)
            affectedCount++
          }
        }
        return { success: true, message: `已替换 ${affectedCount} 个条目`, affectedCount }
        
      default:
        return { success: false, message: '未知操作', affectedCount: 0 }
    }
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error ? error.message : '操作失败',
      affectedCount 
    }
  }
}

// ============ 批量导入对话框 ============
interface BulkImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worldInfoId: number
  onImported: () => void
}

export function BulkImportDialog({
  open,
  onOpenChange,
  worldInfoId,
  onImported,
}: BulkImportDialogProps) {
  const { toast } = useToast()
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'json' | 'csv' | 'simple'>('json')
  const [importing, setImporting] = useState(false)
  
  const handleImport = async () => {
    if (!importText.trim()) return
    
    setImporting(true)
    try {
      let entries: Partial<TavernWorldInfoEntry>[] = []
      
      if (mode === 'json') {
        const parsed = JSON.parse(importText)
        entries = Array.isArray(parsed) ? parsed : [parsed]
      } else if (mode === 'csv') {
        // 简单 CSV 解析: keys,content
        const lines = importText.split('\n').filter(l => l.trim())
        entries = lines.map((line, i) => {
          const [keys, content] = line.split(',', 2)
          return {
            keys: JSON.stringify(keys.split('|').map(k => k.trim())),
            content: content?.trim() || '',
            comment: `导入条目 ${i + 1}`,
          }
        })
      } else {
        // 简单格式: 每行一个条目，格式 "关键词: 内容"
        const lines = importText.split('\n').filter(l => l.trim())
        entries = lines.map((line, i) => {
          const colonIndex = line.indexOf(':')
          if (colonIndex > 0) {
            const keys = line.slice(0, colonIndex).trim()
            const content = line.slice(colonIndex + 1).trim()
            return {
              keys: JSON.stringify([keys]),
              content,
              comment: keys,
            }
          }
          return {
            keys: JSON.stringify([]),
            content: line,
            comment: `导入条目 ${i + 1}`,
          }
        })
      }
      
      // 获取当前最大 UID
      const existingEntries = await getWorldInfoEntries(worldInfoId)
      let maxUid = existingEntries.reduce((max, e) => Math.max(max, e.uid), 0)
      
      let imported = 0
      for (const entry of entries) {
        maxUid++
        await insertWorldInfoEntry({
          worldInfoId,
          uid: maxUid,
          keys: entry.keys || '[]',
          secondaryKeys: entry.secondaryKeys || '[]',
          content: entry.content || '',
          comment: entry.comment || '',
          enabled: entry.enabled ?? true,
          constant: entry.constant ?? false,
          selective: entry.selective ?? false,
          selectiveLogic: entry.selectiveLogic ?? 0,
          order: existingEntries.length + imported,
          position: entry.position ?? 0,
          depth: entry.depth ?? 4,
          probability: entry.probability ?? 100,
          group: entry.group || '',
          groupOverride: entry.groupOverride ?? false,
          groupWeight: entry.groupWeight ?? 100,
          scanDepth: entry.scanDepth ?? null,
          caseSensitive: entry.caseSensitive ?? false,
          matchWholeWords: entry.matchWholeWords ?? false,
          automationId: entry.automationId || '',
          excludeRecursion: entry.excludeRecursion ?? false,
          preventRecursion: entry.preventRecursion ?? false,
          vectorized: false,
          useRegex: entry.useRegex ?? false,
          role: entry.role ?? 0,
          useProbability: entry.useProbability ?? true,
          displayIndex: existingEntries.length + imported,
          delayUntilRecursion: entry.delayUntilRecursion ?? false,
          sticky: entry.sticky ?? null,
          cooldown: entry.cooldown ?? null,
          delay: entry.delay ?? null,
        })
        imported++
      }
      
      toast({ description: `成功导入 ${imported} 个条目` })
      onImported()
      onOpenChange(false)
      setImportText('')
    } catch (error) {
      toast({ 
        description: error instanceof Error ? error.message : '导入失败',
        variant: 'destructive'
      })
    } finally {
      setImporting(false)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量导入条目</DialogTitle>
        </DialogHeader>
        
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="json" className="flex-1">JSON</TabsTrigger>
            <TabsTrigger value="csv" className="flex-1">CSV</TabsTrigger>
            <TabsTrigger value="simple" className="flex-1">简单格式</TabsTrigger>
          </TabsList>
          
          <TabsContent value="json" className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">
              粘贴 JSON 数组或对象，支持 SillyTavern 导出格式
            </p>
          </TabsContent>
          <TabsContent value="csv" className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">
              每行一个条目，格式: 关键词1|关键词2,内容
            </p>
          </TabsContent>
          <TabsContent value="simple" className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">
              每行一个条目，格式: 关键词: 内容
            </p>
          </TabsContent>
        </Tabs>
        
        <Textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="粘贴要导入的内容..."
          className="min-h-[300px] font-mono text-sm"
        />
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleImport} disabled={importing || !importText.trim()}>
            {importing ? '导入中...' : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ 条目验证面板 ============
interface EntryValidationPanelProps {
  entries: TavernWorldInfoEntry[]
}

export function EntryValidationPanel({ entries }: EntryValidationPanelProps) {
  const [showValidation, setShowValidation] = useState(false)
  
  // 检测循环依赖
  const circularDeps = detectCircularDependencies(entries)
  
  // 检测引用语法错误
  const syntaxErrors: Array<{ entryId: number; errors: string[] }> = []
  for (const entry of entries) {
    const result = validateReferenceSyntax(entry.content || '')
    if (!result.valid) {
      syntaxErrors.push({ entryId: entry.id, errors: result.errors })
    }
  }
  
  const hasIssues = circularDeps.length > 0 || syntaxErrors.length > 0
  
  if (!hasIssues && !showValidation) return null
  
  return (
    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
      <div className="flex items-center justify-between">
        <span className="font-medium text-yellow-800 dark:text-yellow-200">
          发现 {circularDeps.length + syntaxErrors.length} 个潜在问题
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowValidation(!showValidation)}
        >
          {showValidation ? '隐藏' : '查看'}
        </Button>
      </div>
      
      {showValidation && (
        <div className="mt-2 space-y-2">
          {circularDeps.map((dep, i) => (
            <div key={i} className="text-sm text-yellow-700 dark:text-yellow-300">
              循环引用: 条目 {dep.cycle.join(' → ')}
            </div>
          ))}
          {syntaxErrors.map((err, i) => (
            <div key={i} className="text-sm text-yellow-700 dark:text-yellow-300">
              条目 #{err.entryId}: {err.errors.join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
