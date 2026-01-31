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
import { Calendar, User, FileText } from 'lucide-react'
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

// 初始化 dayjs 插件
dayjs.extend(relativeTime)

export function SyncConfirmDialog() {
  const { currentLocale } = useI18n()
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const {
    isOpen,
    fileName,
    commitInfo,
    onConfirm,
    onCancel,
    onIgnore,
    hideConfirmDialog
  } = useSyncConfirmStore()
  
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

  const handleIgnore = () => {
    onIgnore?.()
    hideConfirmDialog()
  }

  return (
    <>
      {isMobile ? (
        <Drawer open={isOpen} onOpenChange={hideConfirmDialog}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                检测到远程文件更新
              </DrawerTitle>
              <DrawerDescription>
                文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 有远程更新
              </DrawerDescription>
            </DrawerHeader>

            <div className="space-y-4 px-4 overflow-y-auto">
              {/* Commit 信息 */}
              {commitInfo && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium">最新提交信息</h4>
                    <Badge variant="outline" className="text-xs">
                      {commitInfo.sha.slice(0, 7)}
                    </Badge>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                    {/* 提交消息 */}
                    <div>
                      <p className="text-sm font-medium mb-1">提交消息</p>
                      <p className="text-sm">{commitInfo.message}</p>
                    </div>

                    {/* 作者和日期 */}
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

                      {/* 变更统计 */}
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
              <Button variant="outline" onClick={handleIgnore} className="flex-1">
                忽略
              </Button>
              <Button variant="outline" onClick={handleCancel} className="flex-1">
                取消
              </Button>
              <Button onClick={handleConfirm} className="flex-1">
                确认拉取
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isOpen} onOpenChange={hideConfirmDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                检测到远程文件更新
              </DialogTitle>
              <DialogDescription>
                文件 <span className="font-mono bg-muted px-1 rounded">{fileName}</span> 有远程更新
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Commit 信息 */}
              {commitInfo && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium">最新提交信息</h4>
                    <Badge variant="outline" className="text-xs">
                      {commitInfo.sha.slice(0, 7)}
                    </Badge>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                    {/* 提交消息 */}
                    <div>
                      <p className="text-sm font-medium mb-1">提交消息</p>
                      <p className="text-sm">{commitInfo.message}</p>
                    </div>

                    {/* 作者和日期 */}
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

                      {/* 变更统计 */}
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
              <Button variant="outline" onClick={handleIgnore}>
                忽略
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                取消
              </Button>
              <Button onClick={handleConfirm}>
                确认拉取
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
