'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTavernQuickReplyStore } from '@/stores/tavern-quick-reply'
import { TavernQuickReply } from '@/db/tavern'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
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
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { 
  Zap, 
  Plus, 
  Pencil, 
  Trash2,
  ChevronDown,
  Code,
  Settings,
} from 'lucide-react'
import { QRManagerDialog } from './qr-script-editor'

interface QuickReplyWithSet extends TavernQuickReply {
  setName: string
  setColor: string
}

interface QuickReplyBarProps {
  cardId?: number
  charName?: string
  userName?: string
  onSend: (message: string) => void
  disabled?: boolean
  className?: string
}

export function QuickReplyBar({
  cardId,
  charName,
  userName,
  onSend,
  disabled = false,
  className,
}: QuickReplyBarProps) {
  const { init, getVisibleReplies, replaceMacros } = useTavernQuickReplyStore()
  const [replies, setReplies] = useState<QuickReplyWithSet[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [editingReply, setEditingReply] = useState<QuickReplyWithSet | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  const [showManagerDialog, setShowManagerDialog] = useState(false)
  const [scriptEditorReply, setScriptEditorReply] = useState<QuickReplyWithSet | null>(null)
  const [scriptEditorDraft, setScriptEditorDraft] = useState('')

  // 加载快捷回复
  useEffect(() => {
    async function load() {
      await init()
      const visibleReplies = await getVisibleReplies(cardId)
      setReplies(visibleReplies)
    }
    load()
  }, [init, getVisibleReplies, cardId])

  // 执行快捷回复
  const handleExecute = useCallback((reply: QuickReplyWithSet) => {
    if (disabled) return
    
    const message = replaceMacros(reply.message, {
      charName,
      userName,
    })
    
    onSend(message)
  }, [disabled, replaceMacros, charName, userName, onSend])

  // 执行脚本快捷回复
  const handleExecuteScript = useCallback(async (reply: QuickReplyWithSet) => {
    if (disabled) return
    
    // 如果消息以 / 开头，表示是脚本命令
    if (reply.message.startsWith('/')) {
      // 显示脚本编辑器来执行
      setScriptEditorReply(reply)
      setShowScriptEditor(true)
    } else {
      handleExecute(reply)
    }
  }, [disabled, handleExecute])

  // 同步脚本编辑器草稿
  useEffect(() => {
    if (showScriptEditor && scriptEditorReply) {
      setScriptEditorDraft(scriptEditorReply.message)
    }
  }, [showScriptEditor, scriptEditorReply])

  // 如果没有快捷回复，不显示
  if (replies.length === 0) {
    return null
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {/* 快捷回复按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">快捷回复</span>
            <ChevronDown className={cn(
              'h-3 w-3 transition-transform',
              isExpanded && 'rotate-180'
            )} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>快捷回复按钮</p>
        </TooltipContent>
      </Tooltip>
      
      {/* 管理按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowManagerDialog(true)}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>管理快捷回复</p>
        </TooltipContent>
      </Tooltip>

      {/* 展开的快捷回复列表 */}
      {isExpanded && (
        <ScrollArea className="max-w-[400px]">
          <div className="flex items-center gap-1 py-1">
            {replies.map((reply) => (
              <QuickReplyButton
                key={reply.id}
                reply={reply}
                onExecute={() => handleExecute(reply)}
                onEdit={() => {
                  setEditingReply(reply)
                  setIsEditDialogOpen(true)
                }}
                disabled={disabled}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}

      {/* 编辑对话框 */}
      <QuickReplyEditDialog
        reply={editingReply}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSave={async () => {
          // 刷新列表
          const visibleReplies = await getVisibleReplies(cardId)
          setReplies(visibleReplies)
          setIsEditDialogOpen(false)
          setEditingReply(null)
        }}
      />
      
      {/* 脚本编辑器 */}
      {showScriptEditor && scriptEditorReply && (
        <Dialog open={showScriptEditor} onOpenChange={setShowScriptEditor}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>脚本编辑器 - {scriptEditorReply.label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                value={scriptEditorDraft}
                onChange={(e) => setScriptEditorDraft(e.target.value)}
                className="min-h-[260px] font-mono"
                placeholder="输入 / 开头的脚本命令（可编辑后执行或保存）"
              />
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowScriptEditor(false)}
                >
                  取消
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const { updateReply } = useTavernQuickReplyStore.getState()
                    await updateReply(scriptEditorReply.id, { message: scriptEditorDraft })
                    const visibleReplies = await getVisibleReplies(cardId)
                    setReplies(visibleReplies)
                    setShowScriptEditor(false)
                  }}
                >
                  保存
                </Button>
                <Button
                  onClick={() => {
                    const message = replaceMacros(scriptEditorDraft, { charName, userName })
                    onSend(message)
                    setShowScriptEditor(false)
                  }}
                >
                  执行
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      {/* 管理对话框 */}
      <QRManagerDialog
        open={showManagerDialog}
        onOpenChange={setShowManagerDialog}
        cardId={cardId}
        onRefresh={async () => {
          const visibleReplies = await getVisibleReplies(cardId)
          setReplies(visibleReplies)
        }}
      />
    </div>
  )
}

// 单个快捷回复按钮
interface QuickReplyButtonProps {
  reply: QuickReplyWithSet
  onExecute: () => void
  onEdit: () => void
  disabled?: boolean
}

function QuickReplyButton({ reply, onExecute, onEdit, disabled }: QuickReplyButtonProps) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-7 px-2 text-xs whitespace-nowrap',
                reply.setColor && `border-[${reply.setColor}]`
              )}
              style={reply.setColor ? { borderColor: reply.setColor } : undefined}
              disabled={disabled}
              onClick={(e) => {
                // 左键点击直接执行
                if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  onExecute()
                }
              }}
              onContextMenu={(e) => {
                // 右键打开菜单
                e.preventDefault()
              }}
            >
              {reply.icon && (
                <i className={cn('fa-solid mr-1', reply.icon)} />
              )}
              {reply.label}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <p className="font-medium">{reply.title || reply.label}</p>
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
            {reply.message.slice(0, 100)}
            {reply.message.length > 100 && '...'}
          </p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-8"
            onClick={onExecute}
            disabled={disabled}
          >
            <Zap className="h-4 w-4 mr-2" />
            执行
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-8"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4 mr-2" />
            编辑
          </Button>
          {reply.message.startsWith('/') && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-8"
              onClick={onEdit}
            >
              <Code className="h-4 w-4 mr-2" />
              脚本编辑器
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// 编辑对话框
interface QuickReplyEditDialogProps {
  reply: QuickReplyWithSet | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
}

function QuickReplyEditDialog({ reply, open, onOpenChange, onSave }: QuickReplyEditDialogProps) {
  const { updateReply, deleteReply } = useTavernQuickReplyStore()
  const [label, setLabel] = useState('')
  const [message, setMessage] = useState('')
  const [title, setTitle] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 初始化表单
  useEffect(() => {
    if (reply) {
      setLabel(reply.label)
      setMessage(reply.message)
      setTitle(reply.title)
    }
  }, [reply])

  const handleSave = async () => {
    if (!reply || !label.trim()) return
    
    setIsSaving(true)
    try {
      await updateReply(reply.id, {
        label: label.trim(),
        message: message.trim(),
        title: title.trim(),
      })
      onSave()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!reply) return
    if (!confirm('确定要删除这个快捷回复吗？')) return
    
    await deleteReply(reply.id, reply.setId)
    onSave()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>编辑快捷回复</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="qr-label">标签</Label>
            <Input
              id="qr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="按钮显示的文字"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qr-title">提示</Label>
            <Input
              id="qr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="悬停时显示的提示"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="qr-message">内容</Label>
            <Textarea
              id="qr-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="发送的消息内容，支持 {{char}} {{user}} 等宏"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              支持宏: {'{{char}}'} {'{{user}}'} {'{{time}}'} {'{{date}}'} {'{{random}}'}
            </p>
          </div>
        </div>
        <DialogFooter className="flex justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            删除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !label.trim()}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 快捷回复管理面板 (用于设置页面)
export function QuickReplyManager() {
  const {
    sets,
    repliesBySet,
    isLoading,
    init,
    createSet,
    updateSet,
    deleteSet,
    createReply,
    deleteReply,
  } = useTavernQuickReplyStore()

  const [newSetName, setNewSetName] = useState('')
  const [newReplyLabel, setNewReplyLabel] = useState('')
  const [newReplyMessage, setNewReplyMessage] = useState('')
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const handleCreateSet = async () => {
    if (!newSetName.trim()) return
    await createSet(newSetName.trim())
    setNewSetName('')
  }

  const handleCreateReply = async () => {
    if (!selectedSetId || !newReplyLabel.trim()) return
    await createReply(selectedSetId, newReplyLabel.trim(), newReplyMessage.trim())
    setNewReplyLabel('')
    setNewReplyMessage('')
  }

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">加载中...</div>
  }

  return (
    <div className="space-y-6">
      {/* 创建新集合 */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">快捷回复集合</h3>
        <div className="flex gap-2">
          <Input
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
            placeholder="新集合名称"
            className="flex-1"
          />
          <Button onClick={handleCreateSet} disabled={!newSetName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            创建
          </Button>
        </div>
      </div>

      {/* 集合列表 */}
      <div className="space-y-4">
        {sets.map((set) => (
          <div key={set.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">{set.name}</h4>
                <span className="text-xs text-muted-foreground">
                  ({set.scope === 'global' ? '全局' : '角色绑定'})
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateSet(set.id, { isEnabled: !set.isEnabled })}
                >
                  {set.isEnabled ? '禁用' : '启用'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (confirm('确定要删除这个集合吗？')) {
                      deleteSet(set.id)
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 快捷回复列表 */}
            <div className="space-y-2">
              {(repliesBySet.get(set.id) || []).map((reply) => (
                <div
                  key={reply.id}
                  className="flex items-center justify-between p-2 bg-muted rounded"
                >
                  <div>
                    <span className="font-medium">{reply.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {reply.message.slice(0, 30)}
                      {reply.message.length > 30 && '...'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => deleteReply(reply.id, set.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* 添加新快捷回复 */}
            {selectedSetId === set.id ? (
              <div className="space-y-2 pt-2 border-t">
                <Input
                  value={newReplyLabel}
                  onChange={(e) => setNewReplyLabel(e.target.value)}
                  placeholder="按钮标签"
                />
                <Textarea
                  value={newReplyMessage}
                  onChange={(e) => setNewReplyMessage(e.target.value)}
                  placeholder="消息内容"
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateReply}
                    disabled={!newReplyLabel.trim()}
                  >
                    添加
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedSetId(null)
                      setNewReplyLabel('')
                      setNewReplyMessage('')
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedSetId(set.id)}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加快捷回复
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
