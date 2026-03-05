'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, User, GitMerge, ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import { useI18n } from '@/hooks/useI18n'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import { cn } from '@/lib/utils'
import emitter from '@/lib/emitter'
import { getSyncPushQueue } from '@/lib/sync/sync-push-queue'
import { useEffect } from 'react'

// 初始化 dayjs 插件
dayjs.extend(relativeTime)

export function SyncConfirmDialog() {
  const { currentLocale } = useI18n()
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const {
    isOpen,
    dialogType,
    fileName,
    commitInfo,
    localSha,
    remoteSha,
    onConfirm,
    onCancel,
    onKeepLocal,
    onMerge,
    onIgnore,
    hideConfirmDialog,
    showShaMismatchDialog
  } = useSyncConfirmStore()

  // 监听 SHA 不匹配事件，显示确认对话框
  useEffect(() => {
    const handleShaMismatch = async (data: { path: string; localSha?: string; remoteSha?: string }) => {
      const fileName = data.path.split('/').pop() || data.path
      const syncPushQueue = getSyncPushQueue()

      showShaMismatchDialog({
        fileName,
        localSha: data.localSha,
        remoteSha: data.remoteSha,
        onForceUpload: async () => {
          // 用户确认强制上传
          await syncPushQueue.forcePush(data.path)
        },
        onCancel: () => {
          // 用户取消，不做任何操作
        }
      })
    }

    emitter.on('sync-sha-mismatch', handleShaMismatch)

    return () => {
      emitter.off('sync-sha-mismatch', handleShaMismatch)
    }
  }, [showShaMismatchDialog])

  const getLocale = () => {
    switch (currentLocale) {
      case 'zh': return 'zh-cn'
      case 'ja': return 'ja'
      case 'pt-BR': return 'pt-br'
      default: return 'en'
    }
  }

  const formatDate = (date: Date) => {
    return dayjs(date).locale(getLocale()).fromNow()
  }

  const handleConfirm = () => {
    onConfirm?.()
    hideConfirmDialog()
  }

  const handleCancel = () => {
    onCancel?.()
    hideConfirmDialog()
  }

  const handleKeepLocal = () => {
    onKeepLocal?.()
    hideConfirmDialog()
  }

  const handleMerge = () => {
    onMerge?.()
    hideConfirmDialog()
  }

  const handleIgnore = () => {
    onIgnore?.()
    hideConfirmDialog()
  }

  const isPullDialog = dialogType === 'pull'
  const isConflictDialog = dialogType === 'conflict'
  const isShaMismatchDialog = dialogType === 'shaMismatch'

  return (
    <>
      {isMobile ? (
        <Drawer open={isOpen} onOpenChange={hideConfirmDialog}>
          <DrawerContent className="max-h-[85vh]">
            {isPullDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <ArrowDownToLine className="h-5 w-5" />
                    检测到远程文件更新
                  </DrawerTitle>
                  <DrawerDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 有远程更新
                  </DrawerDescription>
                </DrawerHeader>

                <div className="space-y-4 px-4 overflow-y-auto">
                  {commitInfo && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">最新提交信息</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                        <div>
                          <p className="text-sm font-medium mb-1">提交消息</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground gap-2">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {commitInfo.author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(commitInfo.date)}
                            </div>
                          </div>

                          {(commitInfo.additions !== undefined || commitInfo.deletions !== undefined) && (
                            <div className="flex items-center gap-2">
                              {commitInfo.additions !== undefined && commitInfo.additions > 0 && (
                                <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                  +{commitInfo.additions}
                                </Badge>
                              )}
                              {commitInfo.deletions !== undefined && commitInfo.deletions > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  -{commitInfo.deletions}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <DrawerFooter className="flex-row gap-2">
                  {onIgnore && (
                    <Button variant="outline" onClick={handleIgnore} className="flex-1">
                      忽略
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleCancel} className="flex-1">
                    取消
                  </Button>
                  <Button onClick={handleConfirm} className="flex-1">
                    确认拉取
                  </Button>
                </DrawerFooter>
              </>
            )}

            {isConflictDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    文件冲突检测
                  </DrawerTitle>
                  <DrawerDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 存在冲突
                  </DrawerDescription>
                </DrawerHeader>

                <div className="space-y-4 px-4 overflow-y-auto">
                  {commitInfo && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">远程版本信息</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="bg-muted/30 p-4 rounded-lg space-y-2">
                        <div>
                          <p className="text-sm font-medium mb-1">提交消息</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            {commitInfo.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(commitInfo.date)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-lg">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      请选择如何处理此冲突：保留本地版本、保留远程版本，或取消后手动合并。
                    </p>
                  </div>
                </div>

                <DrawerFooter className="flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="outline" onClick={handleKeepLocal} className="gap-2">
                      <ArrowUpFromLine className="h-4 w-4" />
                      保留本地
                    </Button>
                    <Button variant="default" onClick={handleConfirm} className="gap-2">
                      <ArrowDownToLine className="h-4 w-4" />
                      保留远程
                    </Button>
                  </div>
                  {onMerge && (
                    <Button variant="secondary" onClick={handleMerge} className="w-full gap-2">
                      <GitMerge className="h-4 w-4" />
                      合并两者
                    </Button>
                  )}
                  <Button variant="ghost" onClick={handleCancel} className="w-full gap-2">
                    <X className="h-4 w-4" />
                    取消
                  </Button>
                </DrawerFooter>
              </>
            )}

            {isShaMismatchDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    同步冲突检测
                  </DrawerTitle>
                  <DrawerDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 推送失败
                  </DrawerDescription>
                </DrawerHeader>

                <div className="space-y-4 px-4 overflow-y-auto">
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-lg">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      远程文件的 SHA 与本地记录不一致，可能已被其他设备修改。
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">本地记录 SHA：</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {localSha ? localSha.slice(0, 7) : '无'}
                      </code>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">远程文件 SHA：</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {remoteSha ? remoteSha.slice(0, 7) : '无'}
                      </code>
                    </div>
                  </div>
                </div>

                <DrawerFooter className="flex-row gap-2">
                  <Button variant="outline" onClick={handleCancel} className="flex-1">
                    取消
                  </Button>
                  <Button variant="destructive" onClick={handleConfirm} className="flex-1 gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    强制上传
                  </Button>
                </DrawerFooter>
              </>
            )}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isOpen} onOpenChange={hideConfirmDialog}>
          <DialogContent className="max-w-2xl">
            {isPullDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowDownToLine className="h-5 w-5" />
                    检测到远程文件更新
                  </DialogTitle>
                  <DialogDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 有远程更新
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {commitInfo && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">最新提交信息</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                        <div>
                          <p className="text-sm font-medium mb-1">提交消息</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>

                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {commitInfo.author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(commitInfo.date)}
                            </div>
                          </div>

                          {(commitInfo.additions !== undefined || commitInfo.deletions !== undefined) && (
                            <div className="flex items-center gap-2">
                              {commitInfo.additions !== undefined && commitInfo.additions > 0 && (
                                <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                  +{commitInfo.additions}
                                </Badge>
                              )}
                              {commitInfo.deletions !== undefined && commitInfo.deletions > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  -{commitInfo.deletions}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  {onIgnore && (
                    <Button variant="outline" onClick={handleIgnore}>
                      忽略
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleCancel}>
                    取消
                  </Button>
                  <Button onClick={handleConfirm}>
                    确认拉取
                  </Button>
                </DialogFooter>
              </>
            )}

            {isConflictDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    文件冲突检测
                  </DialogTitle>
                  <DialogDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 存在冲突
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {commitInfo && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">远程版本信息</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="bg-muted/30 p-4 rounded-lg space-y-2">
                        <div>
                          <p className="text-sm font-medium mb-1">提交消息</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            {commitInfo.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(commitInfo.date)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className={cn(
                    "p-4 rounded-lg",
                    "bg-yellow-50 dark:bg-yellow-900/20",
                    "border border-yellow-200 dark:border-yellow-800"
                  )}>
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      请选择如何处理此冲突：保留本地版本、保留远程版本，或取消后手动合并。
                    </p>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={handleKeepLocal} className="gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    保留本地
                  </Button>
                  {onMerge && (
                    <Button variant="secondary" onClick={handleMerge} className="gap-2">
                      <GitMerge className="h-4 w-4" />
                      合并两者
                    </Button>
                  )}
                  <Button variant="default" onClick={handleConfirm} className="gap-2">
                    <ArrowDownToLine className="h-4 w-4" />
                    保留远程
                  </Button>
                  <Button variant="ghost" onClick={handleCancel} className="gap-2">
                    <X className="h-4 w-4" />
                    取消
                  </Button>
                </DialogFooter>
              </>
            )}

            {isShaMismatchDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    同步冲突检测
                  </DialogTitle>
                  <DialogDescription>
                    文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 推送失败
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className={cn(
                    "p-4 rounded-lg",
                    "bg-red-50 dark:bg-red-900/20",
                    "border border-red-200 dark:border-red-800"
                  )}>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      远程文件的 SHA 与本地记录不一致，可能已被其他设备修改。
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">本地记录 SHA：</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {localSha ? localSha.slice(0, 7) : '无'}
                      </code>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">远程文件 SHA：</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {remoteSha ? remoteSha.slice(0, 7) : '无'}
                      </code>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={handleCancel}>
                    取消
                  </Button>
                  <Button variant="destructive" onClick={handleConfirm} className="gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    强制上传（覆盖远程）
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
