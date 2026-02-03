'use client'

import { useState, useCallback, useRef, ChangeEvent } from 'react'
import {
  useTavernAttachmentsStore,
  Attachment,
  DataBankEntry,
} from '@/stores/tavern-attachments'
import {
  createAttachmentFromFile,
  formatFileSize,
  getAttachmentTypeIcon,
  getAttachmentTypeName,
  getContentPreview,
  getTextFromClipboard,
  createTextAttachment,
  getDataBankStats,
  searchDataBank,
  exportDataBankEntry,
  importDataBankEntry,
  exportDataBank,
  importDataBank,
  estimateAttachmentTokens,
} from '@/lib/tavern/attachments-service'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  Paperclip,
  Upload,
  X,
  FileText,
  Database,
  Plus,
  Trash2,
  Settings2,
  ChevronDown,
  HelpCircle,
  Clipboard,
  Eye,
  FolderOpen,
  Search,
  Download,
  Import,
  Edit,
  Tag,
  MoreHorizontal,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AttachmentType } from '@/stores/tavern-attachments'

interface AttachmentsPanelProps {
  chatId?: number
  compact?: boolean
  className?: string
}

export function AttachmentsPanel({
  chatId,
  compact = false,
  className,
}: AttachmentsPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activeTab, setActiveTab] = useState('pending')

  const {
    config,
    pendingAttachments,
    dataBank,
    updateConfig,
  } = useTavernAttachmentsStore()

  // 紧凑模式
  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 gap-1 text-xs',
                  pendingAttachments.length > 0 && 'text-orange-600',
                  className
                )}
              >
                <Paperclip className="h-4 w-4" />
                {pendingAttachments.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1 text-xs">
                    {pendingAttachments.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>附件 {pendingAttachments.length > 0 ? `(${pendingAttachments.length} 个)` : ''}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96 p-0" align="end">
          <AttachmentsContent
            config={config}
            pendingAttachments={pendingAttachments}
            dataBank={dataBank}
            onUpdateConfig={updateConfig}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式
  return (
    <div className={cn('space-y-4', className)}>
      <AttachmentsContent
        config={config}
        pendingAttachments={pendingAttachments}
        dataBank={dataBank}
        onUpdateConfig={updateConfig}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        expanded
      />
    </div>
  )
}

// 内容组件
interface AttachmentsContentProps {
  config: ReturnType<typeof useTavernAttachmentsStore.getState>['config']
  pendingAttachments: Attachment[]
  dataBank: DataBankEntry[]
  onUpdateConfig: (updates: Partial<ReturnType<typeof useTavernAttachmentsStore.getState>['config']>) => void
  activeTab: string
  setActiveTab: (tab: string) => void
  showAdvanced: boolean
  setShowAdvanced: (show: boolean) => void
  expanded?: boolean
}

function AttachmentsContent({
  config,
  pendingAttachments,
  dataBank,
  onUpdateConfig,
  activeTab,
  setActiveTab,
  showAdvanced,
  setShowAdvanced,
  expanded = false,
}: AttachmentsContentProps) {
  const [showHelp, setShowHelp] = useState(false)
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    addPendingAttachment,
    removePendingAttachment,
    clearPendingAttachments,
    updatePendingAttachment,
    addDataBankEntry,
    deleteDataBankEntry,
    addFromDataBank,
  } = useTavernAttachmentsStore()

  // 处理文件选择
  const handleFileSelect = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (const file of Array.from(files)) {
      try {
        const attachment = await createAttachmentFromFile(file)
        if (attachment) {
          addPendingAttachment(attachment)
        }
      } catch (error) {
        console.error('添加附件失败:', error)
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [addPendingAttachment])

  // 从剪贴板粘贴
  const handlePaste = useCallback(async () => {
    const text = await getTextFromClipboard()
    if (text) {
      const attachment = createTextAttachment('剪贴板内容', text)
      addPendingAttachment(attachment)
    }
  }, [addPendingAttachment])

  // 保存到数据银行
  const handleSaveToDataBank = useCallback(() => {
    if (pendingAttachments.length === 0) return
    
    addDataBankEntry({
      name: `附件集合 ${new Date().toLocaleDateString()}`,
      description: '',
      attachments: pendingAttachments,
    })
  }, [pendingAttachments, addDataBankEntry])

  return (
    <div className="flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-orange-600" />
          <span className="font-medium text-sm">附件管理</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowHelp(!showHelp)}
              >
                <HelpCircle className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                添加文件附件到对话上下文中，支持文本、代码、数据等文件。
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => onUpdateConfig({ enabled })}
          />
          <span className="text-xs text-muted-foreground">
            {config.enabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      {/* 帮助信息 */}
      {showHelp && (
        <div className="p-3 bg-muted/50 border-b text-xs space-y-1">
          <p><strong>使用方法:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li>上传文件或粘贴文本作为附件</li>
            <li>附件内容会包含在对话上下文中</li>
            <li>可保存常用附件到数据银行</li>
          </ul>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="w-full justify-start px-3 pt-2">
          <TabsTrigger value="pending" className="text-xs">
            <FileText className="h-3 w-3 mr-1" />
            待发送 ({pendingAttachments.length})
          </TabsTrigger>
          <TabsTrigger value="databank" className="text-xs">
            <Database className="h-3 w-3 mr-1" />
            数据银行 ({dataBank.length})
          </TabsTrigger>
        </TabsList>

        <ScrollArea className={cn('flex-1', expanded ? 'h-[350px]' : 'max-h-[300px]')}>
          {/* 待发送附件 */}
          <TabsContent value="pending" className="p-3 space-y-3 mt-0">
            {/* 上传区域 */}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                上传文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePaste}
              >
                <Clipboard className="h-4 w-4 mr-1" />
                粘贴
              </Button>
            </div>

            {/* 附件列表 */}
            {pendingAttachments.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">附件列表</Label>
                    <Badge variant="secondary" className="text-xs">
                      ~{pendingAttachments.reduce((sum, a) => sum + estimateAttachmentTokens(a), 0)} tokens
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleSaveToDataBank}
                    >
                      <Database className="h-3 w-3 mr-1" />
                      保存
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive"
                      onClick={clearPendingAttachments}
                    >
                      清空
                    </Button>
                  </div>
                </div>
                {pendingAttachments.map((attachment) => (
                  <AttachmentItem
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() => removePendingAttachment(attachment.id)}
                    onPreview={() => setPreviewAttachment(attachment)}
                    onToggleContext={(include) => 
                      updatePendingAttachment(attachment.id, { includeInContext: include })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无附件</p>
              </div>
            )}
          </TabsContent>

          {/* 数据银行 */}
          <TabsContent value="databank" className="p-3 space-y-3 mt-0">
            <DataBankPanel
              dataBank={dataBank}
              onAddFromDataBank={addFromDataBank}
              onDeleteEntry={deleteDataBankEntry}
              expanded={expanded}
            />
          </TabsContent>
        </ScrollArea>

        {/* 高级设置 */}
        <div className="p-3 border-t">
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-1">
                  <Settings2 className="h-4 w-4" />
                  高级设置
                </span>
                <ChevronDown className={cn(
                  'h-4 w-4 transition-transform',
                  showAdvanced && 'rotate-180'
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">默认包含在上下文</Label>
                <Switch
                  checked={config.defaultIncludeInContext}
                  onCheckedChange={(checked) => onUpdateConfig({ defaultIncludeInContext: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">显示预览</Label>
                <Switch
                  checked={config.showPreview}
                  onCheckedChange={(checked) => onUpdateConfig({ showPreview: checked })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">最大内容长度</Label>
                <Input
                  type="number"
                  value={config.defaultMaxLength}
                  onChange={(e) => onUpdateConfig({ defaultMaxLength: parseInt(e.target.value) || 10000 })}
                  min={0}
                  className="h-8"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </Tabs>

      {/* 预览对话框 */}
      {previewAttachment && (
        <AttachmentPreviewDialog
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </div>
  )
}

// 附件项组件
interface AttachmentItemProps {
  attachment: Attachment
  onRemove: () => void
  onPreview: () => void
  onToggleContext: (include: boolean) => void
}

function AttachmentItem({
  attachment,
  onRemove,
  onPreview,
  onToggleContext,
}: AttachmentItemProps) {
  const { config } = useTavernAttachmentsStore()

  return (
    <div className="flex items-start gap-2 p-2 rounded-lg border bg-muted/30">
      <div className="text-lg flex-shrink-0">
        {getAttachmentTypeIcon(attachment.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium truncate">{attachment.name}</span>
          <Badge variant="outline" className="text-xs">
            {getAttachmentTypeName(attachment.type)}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatFileSize(attachment.size)}
        </div>
        {config.showPreview && (
          <div className="mt-1 text-xs text-muted-foreground font-mono bg-muted p-1 rounded max-h-16 overflow-hidden">
            {getContentPreview(attachment.content, 3)}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-6 w-6', attachment.includeInContext && 'text-green-600')}
              onClick={() => onToggleContext(!attachment.includeInContext)}
            >
              <FileText className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {attachment.includeInContext ? '已包含在上下文' : '未包含在上下文'}
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onPreview}
        >
          <Eye className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ============ 数据银行面板 ============
interface DataBankPanelProps {
  dataBank: DataBankEntry[]
  onAddFromDataBank: (entryId: string) => void
  onDeleteEntry: (entryId: string) => void
  expanded?: boolean
}

function DataBankPanel({
  dataBank,
  onAddFromDataBank,
  onDeleteEntry,
  expanded,
}: DataBankPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AttachmentType | 'all'>('all')
  const [editingEntry, setEditingEntry] = useState<DataBankEntry | null>(null)
  const [showStats, setShowStats] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const { updateDataBankEntry, addDataBankEntry } = useTavernAttachmentsStore()
  
  // 搜索结果
  const filteredEntries = searchQuery
    ? searchDataBank(searchQuery, {
        searchContent: true,
        type: typeFilter !== 'all' ? typeFilter : undefined,
      }).map(r => r.entry)
    : dataBank.filter(entry => {
        if (typeFilter === 'all') return true
        return entry.attachments.some(a => a.type === typeFilter)
      })
  
  // 统计信息
  const stats = getDataBankStats()
  
  // 导入数据银行
  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      const text = await file.text()
      const result = importDataBank(text)
      
      if (result.success) {
        alert(`成功导入 ${result.count} 个条目`)
      } else {
        alert(`导入失败: ${result.error}`)
      }
    }
    input.click()
  }, [])
  
  // 导出数据银行
  const handleExport = useCallback(() => {
    const data = exportDataBank()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `data-bank-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])
  
  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索附件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-24 h-8">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="text">文本</SelectItem>
            <SelectItem value="code">代码</SelectItem>
            <SelectItem value="document">文档</SelectItem>
            <SelectItem value="data">数据</SelectItem>
            <SelectItem value="other">其他</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleImport}>
              <Import className="h-4 w-4 mr-2" />
              导入数据银行
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              导出数据银行
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowStats(!showStats)}>
              <Database className="h-4 w-4 mr-2" />
              {showStats ? '隐藏统计' : '显示统计'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* 统计信息 */}
      {showStats && (
        <div className="grid grid-cols-2 gap-2 p-2 bg-muted/50 rounded-lg text-xs">
          <div>
            <div className="text-muted-foreground">条目数</div>
            <div className="font-medium">{stats.totalEntries}</div>
          </div>
          <div>
            <div className="text-muted-foreground">附件数</div>
            <div className="font-medium">{stats.totalAttachments}</div>
          </div>
          <div>
            <div className="text-muted-foreground">总大小</div>
            <div className="font-medium">{formatFileSize(stats.totalSize)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">类型分布</div>
            <div className="font-medium text-[10px]">
              {Object.entries(stats.byType).filter(([_, c]) => c > 0).map(([t, c]) => `${t}:${c}`).join(' ')}
            </div>
          </div>
        </div>
      )}
      
      {/* 条目列表 */}
      {filteredEntries.length > 0 ? (
        <div className="space-y-2">
          {filteredEntries.map((entry) => (
            <DataBankItem
              key={entry.id}
              entry={entry}
              onUse={() => onAddFromDataBank(entry.id)}
              onEdit={() => setEditingEntry(entry)}
              onExport={() => {
                const data = exportDataBankEntry(entry.id)
                if (!data) return
                const blob = new Blob([data], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${entry.name}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              onDelete={() => onDeleteEntry(entry.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{searchQuery ? '无搜索结果' : '数据银行为空'}</p>
          {!searchQuery && <p className="text-xs mt-1">保存常用附件以便快速使用</p>}
        </div>
      )}
      
      {/* 编辑对话框 */}
      {editingEntry && (
        <DataBankEntryEditor
          entry={editingEntry}
          onSave={(updates) => {
            updateDataBankEntry(editingEntry.id, updates)
            setEditingEntry(null)
          }}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  )
}

// 数据银行项组件
interface DataBankItemProps {
  entry: DataBankEntry
  onUse: () => void
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}

function DataBankItem({ entry, onUse, onEdit, onExport, onDelete }: DataBankItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  
  // 计算总 token 估算
  const totalTokens = entry.attachments.reduce(
    (sum, a) => sum + estimateAttachmentTokens(a),
    0
  )
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 p-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{entry.name}</div>
            <div className="text-xs text-muted-foreground flex gap-2">
              <span>{entry.attachments.length} 附件</span>
              <span>~{totalTokens} tokens</span>
              <span>{new Date(entry.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={onUse}
            >
              <Plus className="h-3 w-3 mr-1" />
              使用
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExport}>
                  <Download className="h-4 w-4 mr-2" />
                  导出
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-1">
            {entry.description && (
              <p className="text-xs text-muted-foreground px-2">{entry.description}</p>
            )}
            <div className="border-t pt-2">
              {entry.attachments.map((attachment, idx) => (
                <div key={attachment.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="opacity-70">{getAttachmentTypeIcon(attachment.type)}</span>
                  <span className="flex-1 truncate">{attachment.name}</span>
                  <span className="text-muted-foreground">{formatFileSize(attachment.size)}</span>
                  {attachment.tags && attachment.tags.length > 0 && (
                    <div className="flex gap-0.5">
                      {attachment.tags.slice(0, 2).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// 数据银行条目编辑器
interface DataBankEntryEditorProps {
  entry: DataBankEntry
  onSave: (updates: Partial<Omit<DataBankEntry, 'id' | 'createdAt' | 'updatedAt'>>) => void
  onClose: () => void
}

function DataBankEntryEditor({ entry, onSave, onClose }: DataBankEntryEditorProps) {
  const [name, setName] = useState(entry.name)
  const [description, setDescription] = useState(entry.description)
  const [attachments, setAttachments] = useState([...entry.attachments])
  
  const handleSave = () => {
    onSave({ name, description, attachments })
  }
  
  const updateAttachment = (id: string, updates: Partial<Attachment>) => {
    setAttachments(attachments.map(a => a.id === id ? { ...a, ...updates } : a))
  }
  
  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter(a => a.id !== id))
  }
  
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑数据银行条目</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="条目名称"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选描述"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>附件 ({attachments.length})</Label>
            <ScrollArea className="h-48 border rounded-lg p-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 py-1">
                  <span className="text-lg">{getAttachmentTypeIcon(attachment.type)}</span>
                  <Input
                    value={attachment.name}
                    onChange={(e) => updateAttachment(attachment.id, { name: e.target.value })}
                    className="h-7 flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-16">
                    {formatFileSize(attachment.size)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </ScrollArea>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// 预览对话框
interface AttachmentPreviewDialogProps {
  attachment: Attachment
  onClose: () => void
}

function AttachmentPreviewDialog({ attachment, onClose }: AttachmentPreviewDialogProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getAttachmentTypeIcon(attachment.type)}
            {attachment.name}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <pre className="text-sm font-mono whitespace-pre-wrap bg-muted p-4 rounded-lg">
            {attachment.content}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
