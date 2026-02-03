'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
  Plus,
  Pencil,
  Trash2,
  Check,
  FileText,
  ArrowLeft,
  Copy,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTavernSysPromptStore } from '@/stores/tavern-sysprompt'
import { type TavernSysPrompt } from '@/db/tavern'
import { useToast } from '@/hooks/use-toast'
import Link from 'next/link'

export default function SysPromptPage() {
  const { toast } = useToast()
  const {
    prompts,
    enabled,
    loading,
    init,
    refresh,
    enable,
    disableAll,
    create,
    update,
    delete: deletePrompt,
  } = useTavernSysPromptStore()

  // 本地状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<TavernSysPrompt | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TavernSysPrompt | null>(null)

  // 表单状态
  const [formName, setFormName] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formPostHistory, setFormPostHistory] = useState('')

  // 初始化
  useEffect(() => {
    init()
  }, [init])

  // 重置表单
  const resetForm = useCallback(() => {
    setFormName('')
    setFormContent('')
    setFormPostHistory('')
  }, [])

  // 打开编辑对话框
  const openEditDialog = useCallback((prompt: TavernSysPrompt) => {
    setEditingPrompt(prompt)
    setFormName(prompt.name)
    setFormContent(prompt.content)
    setFormPostHistory(prompt.postHistory)
  }, [])

  // 关闭编辑对话框
  const closeEditDialog = useCallback(() => {
    setEditingPrompt(null)
    resetForm()
  }, [resetForm])

  // 创建新预设
  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      toast({ title: '请输入预设名称', variant: 'destructive' })
      return
    }

    try {
      await create(formName.trim(), formContent, formPostHistory)
      toast({ title: '预设创建成功' })
      setIsCreateDialogOpen(false)
      resetForm()
    } catch (error) {
      toast({ title: '创建失败', variant: 'destructive' })
    }
  }, [formName, formContent, formPostHistory, create, resetForm, toast])

  // 更新预设
  const handleUpdate = useCallback(async () => {
    if (!editingPrompt) return
    if (!formName.trim()) {
      toast({ title: '请输入预设名称', variant: 'destructive' })
      return
    }

    try {
      await update(editingPrompt.id, {
        name: formName.trim(),
        content: formContent,
        postHistory: formPostHistory,
      })
      toast({ title: '预设更新成功' })
      closeEditDialog()
    } catch (error) {
      toast({ title: '更新失败', variant: 'destructive' })
    }
  }, [editingPrompt, formName, formContent, formPostHistory, update, closeEditDialog, toast])

  // 删除预设
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return

    try {
      const success = await deletePrompt(deleteTarget.id)
      if (success) {
        toast({ title: '预设已删除' })
      } else {
        toast({ title: '无法删除默认预设', variant: 'destructive' })
      }
      setDeleteTarget(null)
    } catch (error) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }, [deleteTarget, deletePrompt, toast])

  // 切换启用状态
  const handleToggleEnable = useCallback(async (prompt: TavernSysPrompt) => {
    try {
      if (enabled?.id === prompt.id) {
        await disableAll()
        toast({ title: '已禁用 SysPrompt', description: '将使用角色卡自带的系统提示词' })
      } else {
        await enable(prompt.id)
        toast({ title: `已启用: ${prompt.name}` })
      }
    } catch (error) {
      toast({ title: '切换失败', variant: 'destructive' })
    }
  }, [enabled, enable, disableAll, toast])

  // 复制预设
  const handleDuplicate = useCallback(async (prompt: TavernSysPrompt) => {
    try {
      await create(`${prompt.name} (副本)`, prompt.content, prompt.postHistory)
      toast({ title: '预设已复制' })
    } catch (error) {
      toast({ title: '复制失败', variant: 'destructive' })
    }
  }, [create, toast])

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/core/tavern">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6" />
              系统提示词预设
            </h1>
            <p className="text-sm text-muted-foreground">
              管理独立于角色卡的系统提示词 (SysPrompt)
            </p>
          </div>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              新建预设
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>创建系统提示词预设</DialogTitle>
              <DialogDescription>
                创建一个新的系统提示词预设，可以覆盖角色卡自带的系统提示词
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="create-name">预设名称</Label>
                <Input
                  id="create-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如: 中文角色扮演"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-content">主系统提示词</Label>
                <Textarea
                  id="create-content"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="输入主系统提示词内容..."
                  className="min-h-[200px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  支持宏: {'{{char}}'}, {'{{user}}'}, {'{{persona}}'} 等
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-postHistory">历史后提示词 (Jailbreak)</Label>
                <Textarea
                  id="create-postHistory"
                  value={formPostHistory}
                  onChange={(e) => setFormPostHistory(e.target.value)}
                  placeholder="可选，在聊天历史之后注入..."
                  className="min-h-[100px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  留空则使用角色卡自带的 Post-History Instructions
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate}>创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 当前状态提示 */}
      <Card className={cn(
        'border-2',
        enabled ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-muted'
      )}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {enabled ? (
                  <>当前启用: <span className="text-green-600">{enabled.name}</span></>
                ) : (
                  '未启用任何 SysPrompt'
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? '系统提示词将覆盖角色卡自带的 systemPrompt'
                  : '将使用角色卡自带的 systemPrompt'
                }
              </p>
            </div>
            {enabled && (
              <Button variant="outline" size="sm" onClick={disableAll}>
                禁用
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 预设列表 */}
      <ScrollArea className="h-[calc(100vh-320px)]">
        <div className="space-y-3">
          {prompts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>暂无系统提示词预设</p>
                <p className="text-sm mt-1">点击「新建预设」创建第一个</p>
              </CardContent>
            </Card>
          ) : (
            prompts.map((prompt) => (
              <Card
                key={prompt.id}
                className={cn(
                  'transition-colors',
                  enabled?.id === prompt.id && 'border-green-500'
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {prompt.name}
                        {prompt.isDefault && (
                          <span className="text-xs font-normal px-2 py-0.5 rounded bg-muted">
                            默认
                          </span>
                        )}
                        {enabled?.id === prompt.id && (
                          <Check className="h-4 w-4 text-green-600" />
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {prompt.content.slice(0, 100)}
                        {prompt.content.length > 100 && '...'}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={enabled?.id === prompt.id}
                        onCheckedChange={() => handleToggleEnable(prompt)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(prompt)}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDuplicate(prompt)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      复制
                    </Button>
                    {!prompt.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(prompt)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        删除
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* 编辑对话框 */}
      <Dialog open={!!editingPrompt} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑系统提示词预设</DialogTitle>
            <DialogDescription>
              修改预设内容
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">预设名称</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="预设名称"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-content">主系统提示词</Label>
              <Textarea
                id="edit-content"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="输入主系统提示词内容..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-postHistory">历史后提示词 (Jailbreak)</Label>
              <Textarea
                id="edit-postHistory"
                value={formPostHistory}
                onChange={(e) => setFormPostHistory(e.target.value)}
                placeholder="可选，在聊天历史之后注入..."
                className="min-h-[100px] font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog}>
              取消
            </Button>
            <Button onClick={handleUpdate}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除预设「{deleteTarget?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
