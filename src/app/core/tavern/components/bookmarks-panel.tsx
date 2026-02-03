'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  Bookmark,
  Plus,
  MoreVertical,
  Trash2,
  RotateCcw,
  Pencil,
  MessageSquare,
  Clock,
} from 'lucide-react'
import {
  TavernBookmark,
  getBookmarksByChatId,
  createBookmarkFromChat,
  deleteBookmark,
  restoreToBookmark,
  updateBookmarkName,
} from '@/db/tavern'
import { cn } from '@/lib/utils'

interface BookmarksPanelProps {
  chatId?: number
  onRestore?: () => void
  compact?: boolean
}

export function BookmarksPanel({
  chatId,
  onRestore,
  compact = false,
}: BookmarksPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [bookmarks, setBookmarks] = useState<TavernBookmark[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newBookmarkName, setNewBookmarkName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<TavernBookmark | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TavernBookmark | null>(null)

  // 加载书签列表
  const loadBookmarks = useCallback(async () => {
    if (!chatId) {
      setBookmarks([])
      return
    }
    const list = await getBookmarksByChatId(chatId)
    setBookmarks(list)
  }, [chatId])

  useEffect(() => {
    if (isOpen) {
      loadBookmarks()
    }
  }, [isOpen, loadBookmarks])

  // 创建书签
  const handleCreate = useCallback(async () => {
    if (!chatId || !newBookmarkName.trim()) return
    
    await createBookmarkFromChat(chatId, newBookmarkName.trim())
    setNewBookmarkName('')
    setIsCreating(false)
    await loadBookmarks()
  }, [chatId, newBookmarkName, loadBookmarks])

  // 删除书签
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    
    await deleteBookmark(deleteTarget.id)
    setDeleteTarget(null)
    await loadBookmarks()
  }, [deleteTarget, loadBookmarks])

  // 恢复到书签
  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return
    
    const success = await restoreToBookmark(restoreTarget.id)
    setRestoreTarget(null)
    
    if (success) {
      setIsOpen(false)
      onRestore?.()
    }
  }, [restoreTarget, onRestore])

  // 更新书签名称
  const handleUpdateName = useCallback(async () => {
    if (!editingId || !editingName.trim()) return
    
    await updateBookmarkName(editingId, editingName.trim())
    setEditingId(null)
    setEditingName('')
    await loadBookmarks()
  }, [editingId, editingName, loadBookmarks])

  // 开始编辑
  const startEditing = useCallback((bookmark: TavernBookmark) => {
    setEditingId(bookmark.id)
    setEditingName(bookmark.name)
  }, [])

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 紧凑模式按钮
  if (compact) {
    return (
      <TooltipProvider>
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1 text-xs',
                    bookmarks.length > 0 && 'text-blue-600'
                  )}
                  disabled={!chatId}
                >
                  <Bookmark className="h-4 w-4" />
                  <span className="hidden sm:inline">书签</span>
                  {bookmarks.length > 0 && (
                    <span className="text-xs">({bookmarks.length})</span>
                  )}
                </Button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>聊天书签 - 保存和恢复对话检查点</p>
            </TooltipContent>
          </Tooltip>
          <SheetContent side="right" className="w-[400px] sm:w-[540px]">
            <SheetHeader>
              <SheetTitle>聊天书签</SheetTitle>
              <SheetDescription>
                保存对话检查点，随时恢复到之前的状态
              </SheetDescription>
            </SheetHeader>
            <BookmarksList
              bookmarks={bookmarks}
              isCreating={isCreating}
              newBookmarkName={newBookmarkName}
              editingId={editingId}
              editingName={editingName}
              onSetIsCreating={setIsCreating}
              onSetNewBookmarkName={setNewBookmarkName}
              onSetEditingName={setEditingName}
              onCreate={handleCreate}
              onUpdateName={handleUpdateName}
              onStartEditing={startEditing}
              onCancelEditing={() => setEditingId(null)}
              onSetRestoreTarget={setRestoreTarget}
              onSetDeleteTarget={setDeleteTarget}
              formatTime={formatTime}
            />
          </SheetContent>
        </Sheet>

        {/* 恢复确认对话框 */}
        <AlertDialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>恢复到书签点？</AlertDialogTitle>
              <AlertDialogDescription>
                这将删除书签点之后的所有消息，此操作不可撤销。
                <br />
                <br />
                书签: <strong>{restoreTarget?.name}</strong>
                <br />
                消息数: {restoreTarget?.messageCount} 条
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleRestore}>
                确认恢复
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 删除确认对话框 */}
        <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除书签？</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除书签 &ldquo;{deleteTarget?.name}&rdquo; 吗？此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TooltipProvider>
    )
  }

  // 完整模式 (内联显示)
  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Bookmark className="h-4 w-4" />
          聊天书签
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCreating(true)}
          disabled={!chatId}
        >
          <Plus className="h-4 w-4 mr-1" />
          新建
        </Button>
      </div>
      <BookmarksList
        bookmarks={bookmarks}
        isCreating={isCreating}
        newBookmarkName={newBookmarkName}
        editingId={editingId}
        editingName={editingName}
        onSetIsCreating={setIsCreating}
        onSetNewBookmarkName={setNewBookmarkName}
        onSetEditingName={setEditingName}
        onCreate={handleCreate}
        onUpdateName={handleUpdateName}
        onStartEditing={startEditing}
        onCancelEditing={() => setEditingId(null)}
        onSetRestoreTarget={setRestoreTarget}
        onSetDeleteTarget={setDeleteTarget}
        formatTime={formatTime}
      />
    </div>
  )
}


// 书签列表组件
interface BookmarksListProps {
  bookmarks: TavernBookmark[]
  isCreating: boolean
  newBookmarkName: string
  editingId: number | null
  editingName: string
  onSetIsCreating: (v: boolean) => void
  onSetNewBookmarkName: (v: string) => void
  onSetEditingName: (v: string) => void
  onCreate: () => void
  onUpdateName: () => void
  onStartEditing: (bookmark: TavernBookmark) => void
  onCancelEditing: () => void
  onSetRestoreTarget: (bookmark: TavernBookmark) => void
  onSetDeleteTarget: (bookmark: TavernBookmark) => void
  formatTime: (timestamp: number) => string
}

function BookmarksList({
  bookmarks,
  isCreating,
  newBookmarkName,
  editingId,
  editingName,
  onSetIsCreating,
  onSetNewBookmarkName,
  onSetEditingName,
  onCreate,
  onUpdateName,
  onStartEditing,
  onCancelEditing,
  onSetRestoreTarget,
  onSetDeleteTarget,
  formatTime,
}: BookmarksListProps) {
  return (
    <div className="mt-4 space-y-4">
      {/* 创建新书签 */}
      {isCreating ? (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/50">
          <Label>书签名称</Label>
          <Input
            value={newBookmarkName}
            onChange={(e) => onSetNewBookmarkName(e.target.value)}
            placeholder="输入书签名称..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate()
              if (e.key === 'Escape') onSetIsCreating(false)
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSetIsCreating(false)}>
              取消
            </Button>
            <Button size="sm" onClick={onCreate} disabled={!newBookmarkName.trim()}>
              创建
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onSetIsCreating(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          创建书签
        </Button>
      )}

      {/* 书签列表 */}
      <ScrollArea className="h-[400px]">
        {bookmarks.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Bookmark className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无书签</p>
            <p className="text-xs mt-1">创建书签以保存当前对话状态</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {editingId === bookmark.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editingName}
                      onChange={(e) => onSetEditingName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onUpdateName()
                        if (e.key === 'Escape') onCancelEditing()
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={onCancelEditing}>
                        取消
                      </Button>
                      <Button size="sm" onClick={onUpdateName}>
                        保存
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{bookmark.name}</h4>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {bookmark.messageCount} 条消息
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(bookmark.createdAt)}
                          </span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onSetRestoreTarget(bookmark)}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            恢复到此点
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onStartEditing(bookmark)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onSetDeleteTarget(bookmark)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {bookmark.preview && (
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                        {bookmark.preview}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export default BookmarksPanel
