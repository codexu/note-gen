'use client'

import { useMemo } from 'react'
import { CompletionPresetData } from '@/lib/tavern/preset-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface PresetPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presetName: string
  presetData: CompletionPresetData | null
  onConfirmImport?: () => void
}

export function PresetPreviewDialog({
  open,
  onOpenChange,
  presetName,
  presetData,
  onConfirmImport,
}: PresetPreviewDialogProps) {
  if (!presetData) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>预设预览: {presetName}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basic">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">基础参数</TabsTrigger>
            <TabsTrigger value="sampling">采样参数</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[350px] mt-4">
            <TabsContent value="basic" className="mt-0">
              <div className="space-y-2">
                <ParamRow label="最大上下文" value={presetData.basic?.maxContext} />
                <ParamRow label="最大响应" value={presetData.basic?.maxResponse} />
                <ParamRow label="流式输出" value={presetData.basic?.streaming} isBoolean />
                <ParamRow label="解锁上下文" value={presetData.basic?.unlockContext} isBoolean />
                <ParamRow label="种子" value={presetData.basic?.seed} />
              </div>
            </TabsContent>

            <TabsContent value="sampling" className="mt-0">
              <div className="space-y-2">
                <ParamRow label="温度" value={presetData.sampling?.temperature} />
                <ParamRow label="Top P" value={presetData.sampling?.topP} />
                <ParamRow label="Top K" value={presetData.sampling?.topK} />
                <ParamRow label="Min P" value={presetData.sampling?.minP} />
                <ParamRow label="Top A" value={presetData.sampling?.topA} />
                <ParamRow label="重复惩罚" value={presetData.sampling?.repetitionPenalty} />
                <ParamRow label="存在惩罚" value={presetData.sampling?.presencePenalty} />
                <ParamRow label="频率惩罚" value={presetData.sampling?.frequencyPenalty} />
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {onConfirmImport && (
            <Button onClick={onConfirmImport}>
              确认导入
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 参数行组件
interface ParamRowProps {
  label: string
  value: unknown
  isBoolean?: boolean
}

function ParamRow({ label, value, isBoolean }: ParamRowProps) {
  const formatValue = (val: unknown) => {
    if (val === undefined || val === null) return '-'
    if (isBoolean) return val ? '是' : '否'
    if (typeof val === 'number') return Number.isInteger(val) ? val.toString() : val.toFixed(2)
    return String(val)
  }

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg border border-border">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{formatValue(value)}</span>
    </div>
  )
}
