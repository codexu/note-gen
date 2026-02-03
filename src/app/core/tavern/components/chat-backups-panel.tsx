'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTavernChatBackupStore, ChatBackup } from '@/stores/tavern-chat-backup'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { 
  Archive,
  Download,
  Trash2,
  RotateCcw,
  Settings,
  Eye,
  Upload,
  FileJson,
  FileText,
  Loader2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ChatBackupsPanelProps {
  chatId?: number
  cardId?: number
  cardName?: string
  userName?: string
  onRestore?: (newChatId: number) => void
  onImport?: (newChatId: number) => void
  compact?: boolean
}

export function ChatBackupsPanel({
  chatId,
  cardId,
  cardName = '',
  userName = '',
  onRestore,
  onImport,
  compact = false,
}: ChatBackupsPanelProps) {
  const {
    settings,
    updateSettings,
    createBackup,
    getBackups,
    deleteBackup,
    restoreBackup,
    exportBackup,
    exportChatST,
    exportChatJSON,
    importChatFile,
    downloadExportResult,
    selectAndPreviewFile,
    confirmImport,
  } = useTavernChatBackupStore()
  
  const [isOpen, setIsOpen] = useState(false)
  const [backups, setBackups] = useState<ChatBackup[]>([])
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [previewBackup, setPreviewBackup] = useState<ChatBackup | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{
    content: string
    filename: string
    preview: {
      format: string
      messageCount: number
      characterName?: string
      userName?: string
      firstMessages: Array<{ name: string; content: string; role: string }>
      error?: string
    }
  } | null>(null)
  const { toast } = useToast()

  // 加载备份列表
  useEffect(() => {
    if (chatId && isOpen) {
      setBackups(getBackups(chatId))
    }
  }, [chatId, isOpen, getBackups])

  // 手动创建备份
  const handleCreateBackup = useCallback(async () => {
    if (!chatId) return
    
    setIsCreating(true)
    try {
      const backup = await createBackup(chatId, cardName, true)
      if (backup) {
        setBackups(getBackups(chatId))
        toast({ title: '备份创建成功' })
      }
    } finally {
      setIsCreating(false)
    }
  }, [chatId, cardName, createBackup, getBackups])
  
  // 导出为 ST JSONL 格式
  const handleExportST = useCallback(async () => {
    if (!chatId) return
    
    setIsExporting(true)
    try {
      const result = await exportChatST(chatId, cardName, userName)
      if (result.success) {
        downloadExportResult(result)
        toast({ title: '导出成功 (ST JSONL 格式)' })
      } else {
        toast({ title: '导出失败', description: result.error, variant: 'destructive' })
      }
    } finally {
      setIsExporting(false)
    }
  }, [chatId, cardName, userName, exportChatST, downloadExportResult])
  
  // 导出为 JSON 格式
  const handleExportJSON = useCallback(async () => {
    if (!chatId) return
    
    setIsExporting(true)
    try {
      const result = await exportChatJSON(chatId)
      if (result.success) {
        downloadExportResult(result)
        toast({ title: '导出成功 (JSON 格式)' })
      } else {
        toast({ title: '导出失败', description: result.error, variant: 'destructive' })
      }
    } finally {
      setIsExporting(false)
    }
  }, [chatId, exportChatJSON, downloadExportResult])
  
  // 导入聊天文件 - 先选择并预览
  const handleImportChat = useCallback(async () => {
    if (!cardId) {
      toast({ title: '请先选择角色', variant: 'destructive' })
      return
    }
    
    setIsImporting(true)
    try {
      const result = await selectAndPreviewFile()
      if (result) {
        if (result.preview.error) {
          toast({ title: '文件解析失败', description: result.preview.error, variant: 'destructive' })
        } else {
          setImportPreview(result)
        }
      }
    } finally {
      setIsImporting(false)
    }
  }, [cardId, selectAndPreviewFile, toast])
  
  // 确认导入
  const handleConfirmImport = useCallback(async () => {
    if (!importPreview || !cardId) return
    
    setIsImporting(true)
    try {
      const result = await confirmImport(importPreview.content, cardId)
      if (result.success && result.chatId) {
        toast({ title: '导入成功', description: `${result.messageCount} 条消息` })
        setImportPreview(null)
        onImport?.(result.chatId)
      } else {
        toast({ title: '导入失败', description: result.error, variant: 'destructive' })
      }
    } finally {
      setIsImporting(false)
    }
  }, [importPreview, cardId, confirmImport, onImport, toast])

  // 恢复备份
  const handleRestore = useCallback(async (backupId: string) => {
    if (!confirm('确定要恢复此备份吗？将创建一个新的聊天会话。')) return
    
    const newChatId = await restoreBackup(backupId)
    if (newChatId && onRestore) {
      onRestore(newChatId)
    }
  }, [restoreBackup, onRestore])

  // 导出备份
  const handleExport = useCallback((backupId: string, backupName: string) => {
    const json = exportBackup(backupId)
    if (!json) return
    
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backup-${backupName}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportBackup])

  // 删除备份
  const handleDelete = useCallback((backupId: string) => {
    if (!confirm('确定要删除此备份吗？')) return
    
    deleteBackup(backupId)
    if (chatId) {
      setBackups(getBackups(chatId))
    }
  }, [deleteBackup, chatId, getBackups])

  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1">
                <Archive className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">备份</span>
                {backups.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({backups.length})
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>聊天备份</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <BackupsList
            backups={backups}
            onCreateBackup={handleCreateBackup}
            onRestore={handleRestore}
            onExport={handleExport}
            onDelete={handleDelete}
            onPreview={setPreviewBackup}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onExportST={handleExportST}
            onExportJSON={handleExportJSON}
            onImportChat={handleImportChat}
            isCreating={isCreating}
            isExporting={isExporting}
            isImporting={isImporting}
            settings={settings}
            hasChatId={!!chatId}
            hasCardId={!!cardId}
          />
        </PopoverContent>
        
        {/* 设置对话框 */}
        <BackupSettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          settings={settings}
          onUpdateSettings={updateSettings}
        />
        
        {/* 预览对话框 */}
        <BackupPreviewDialog
          backup={previewBackup}
          open={!!previewBackup}
          onOpenChange={(open) => !open && setPreviewBackup(null)}
        />
        
        {/* 导入预览对话框 */}
        <ImportPreviewDialog
          preview={importPreview}
          open={!!importPreview}
          onOpenChange={(open) => !open && setImportPreview(null)}
          onConfirm={handleConfirmImport}
          isImporting={isImporting}
        />
      </Popover>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">聊天备份</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="h-4 w-4 mr-1" />
            设置
          </Button>
          <Button
            size="sm"
            onClick={handleCreateBackup}
            disabled={!chatId || isCreating}
          >
            <Archive className="h-4 w-4 mr-1" />
            创建备份
          </Button>
        </div>
      </div>
      
      <BackupsList
        backups={backups}
        onCreateBackup={handleCreateBackup}
        onRestore={handleRestore}
        onExport={handleExport}
        onDelete={handleDelete}
        onPreview={setPreviewBackup}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onExportST={handleExportST}
        onExportJSON={handleExportJSON}
        onImportChat={handleImportChat}
        isCreating={isCreating}
        isExporting={isExporting}
        isImporting={isImporting}
        settings={settings}
        hasChatId={!!chatId}
        hasCardId={!!cardId}
        expanded
      />
      
      <BackupSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onUpdateSettings={updateSettings}
      />
      
      <BackupPreviewDialog
        backup={previewBackup}
        open={!!previewBackup}
        onOpenChange={(open) => !open && setPreviewBackup(null)}
      />
      
      {/* 导入预览对话框 */}
      <ImportPreviewDialog
        preview={importPreview}
        open={!!importPreview}
        onOpenChange={(open) => !open && setImportPreview(null)}
        onConfirm={handleConfirmImport}
        isImporting={isImporting}
      />
    </div>
  )
}

// 备份列表组件
interface BackupsListProps {
  backups: ChatBackup[]
  onCreateBackup: () => void
  onRestore: (id: string) => void
  onExport: (id: string, name: string) => void
  onDelete: (id: string) => void
  onPreview: (backup: ChatBackup) => void
  onOpenSettings: () => void
  onExportST: () => void
  onExportJSON: () => void
  onImportChat: () => void
  isCreating: boolean
  isExporting: boolean
  isImporting: boolean
  settings: { enabled: boolean }
  hasChatId: boolean
  hasCardId: boolean
  expanded?: boolean
}

function BackupsList({
  backups,
  onCreateBackup,
  onRestore,
  onExport,
  onDelete,
  onPreview,
  onOpenSettings,
  onExportST,
  onExportJSON,
  onImportChat,
  isCreating,
  isExporting,
  isImporting,
  settings,
  hasChatId,
  hasCardId,
  expanded = false,
}: BackupsListProps) {
  return (
    <div className={cn('space-y-2', !expanded && 'p-3')}>
      {/* 头部 */}
      {!expanded && (
        <div className="flex flex-col gap-2 pb-2 border-b">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">聊天管理</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onOpenSettings}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>设置</TooltipContent>
            </Tooltip>
          </div>
          
          {/* 导入导出按钮 */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1"
                  onClick={onImportChat}
                  disabled={isImporting || !hasCardId}
                >
                  {isImporting ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3 mr-1" />
                  )}
                  导入
                </Button>
              </TooltipTrigger>
              <TooltipContent>导入聊天文件 (ST JSONL/JSON)</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1"
                  onClick={onExportST}
                  disabled={isExporting || !hasChatId}
                >
                  {isExporting ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <FileText className="h-3 w-3 mr-1" />
                  )}
                  ST格式
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出为 SillyTavern JSONL 格式</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1"
                  onClick={onExportJSON}
                  disabled={isExporting || !hasChatId}
                >
                  {isExporting ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <FileJson className="h-3 w-3 mr-1" />
                  )}
                  JSON
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出为 JSON 格式</TooltipContent>
            </Tooltip>
          </div>
          
          {/* 备份按钮 */}
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-full"
            onClick={onCreateBackup}
            disabled={isCreating || !hasChatId}
          >
            {isCreating ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Archive className="h-3 w-3 mr-1" />
            )}
            创建备份
          </Button>
        </div>
      )}
      
      {/* 状态指示 */}
      {!settings.enabled && (
        <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
          自动备份已禁用
        </div>
      )}
      
      {/* 备份列表 */}
      {backups.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4">
          暂无备份
        </div>
      ) : (
        <ScrollArea className={cn(expanded ? 'h-auto' : 'max-h-[300px]')}>
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="p-2 rounded border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {backup.chatName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {backup.messageCount} 条消息
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onPreview(backup)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>预览</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onRestore(backup.id)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>恢复</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onExport(backup.id, backup.chatName)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>导出</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => onDelete(backup.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>删除</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

// 设置对话框
interface BackupSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: {
    enabled: boolean
    interval: number
    maxBackups: number
    autoBackupOnClose: boolean
  }
  onUpdateSettings: (updates: Partial<BackupSettingsDialogProps['settings']>) => void
}

function BackupSettingsDialog({
  open,
  onOpenChange,
  settings,
  onUpdateSettings,
}: BackupSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>备份设置</DialogTitle>
          <DialogDescription>
            配置聊天自动备份行为
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="backup-enabled">启用自动备份</Label>
            <Switch
              id="backup-enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) => onUpdateSettings({ enabled: checked })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="backup-interval">备份间隔 (消息数)</Label>
            <Input
              id="backup-interval"
              type="number"
              min={1}
              max={100}
              value={settings.interval}
              onChange={(e) => onUpdateSettings({ interval: parseInt(e.target.value) || 10 })}
            />
            <p className="text-xs text-muted-foreground">
              每隔多少条新消息自动创建备份
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="backup-max">最大备份数量</Label>
            <Input
              id="backup-max"
              type="number"
              min={1}
              max={20}
              value={settings.maxBackups}
              onChange={(e) => onUpdateSettings({ maxBackups: parseInt(e.target.value) || 5 })}
            />
            <p className="text-xs text-muted-foreground">
              每个聊天保留的最大备份数量，超出后自动删除最旧的
            </p>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="backup-on-close">关闭时备份</Label>
              <p className="text-xs text-muted-foreground">
                切换聊天或关闭时自动备份
              </p>
            </div>
            <Switch
              id="backup-on-close"
              checked={settings.autoBackupOnClose}
              onCheckedChange={(checked) => onUpdateSettings({ autoBackupOnClose: checked })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 预览对话框
interface BackupPreviewDialogProps {
  backup: ChatBackup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BackupPreviewDialog({ backup, open, onOpenChange }: BackupPreviewDialogProps) {
  if (!backup) return null
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>备份预览</DialogTitle>
          <DialogDescription>
            {backup.chatName} - {new Date(backup.createdAt).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {backup.messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  'p-3 rounded-lg',
                  msg.role === 'user'
                    ? 'bg-primary/10 ml-8'
                    : msg.role === 'assistant'
                    ? 'bg-muted mr-8'
                    : 'bg-amber-500/10 text-center text-sm'
                )}
              >
                <div className="text-xs text-muted-foreground mb-1">
                  {msg.name} - {msg.role}
                </div>
                <div className="text-sm whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 导入预览对话框
interface ImportPreviewDialogProps {
  preview: {
    content: string
    filename: string
    preview: {
      format: string
      messageCount: number
      characterName?: string
      userName?: string
      firstMessages: Array<{ name: string; content: string; role: string }>
      error?: string
    }
  } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isImporting: boolean
}

function ImportPreviewDialog({
  preview,
  open,
  onOpenChange,
  onConfirm,
  isImporting,
}: ImportPreviewDialogProps) {
  if (!preview) return null
  
  const { filename, preview: data } = preview
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>导入预览</DialogTitle>
          <DialogDescription>
            确认要导入的聊天文件
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* 文件信息 */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">文件名:</span>
              <span className="font-medium">{filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">格式:</span>
              <span className="font-medium">
                {data.format === 'st_jsonl' ? 'SillyTavern JSONL' : 'JSON'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">消息数:</span>
              <span className="font-medium">{data.messageCount} 条</span>
            </div>
            {data.characterName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">角色名:</span>
                <span className="font-medium">{data.characterName}</span>
              </div>
            )}
            {data.userName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">用户名:</span>
                <span className="font-medium">{data.userName}</span>
              </div>
            )}
          </div>
          
          {/* 消息预览 */}
          {data.firstMessages.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">消息预览</Label>
              <ScrollArea className="h-[200px] border rounded-md p-2">
                <div className="space-y-2">
                  {data.firstMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'p-2 rounded text-sm',
                        msg.role === 'user'
                          ? 'bg-primary/10 ml-4'
                          : msg.role === 'assistant'
                          ? 'bg-muted mr-4'
                          : 'bg-amber-500/10 text-center'
                      )}
                    >
                      <div className="text-xs text-muted-foreground mb-1">
                        {msg.name}
                      </div>
                      <div className="line-clamp-2">{msg.content}</div>
                    </div>
                  ))}
                  {data.messageCount > data.firstMessages.length && (
                    <div className="text-center text-xs text-muted-foreground">
                      ... 还有 {data.messageCount - data.firstMessages.length} 条消息
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                确认导入
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
