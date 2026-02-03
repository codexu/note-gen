'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  PromptItem, 
  PromptRole, 
  PromptPosition,
  PromptTrigger,
} from '@/lib/tavern/preset-types'

interface PromptEditorDialogProps {
  prompt: PromptItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (prompt: PromptItem) => void
}

const ROLE_OPTIONS: { value: PromptRole; label: string }[] = [
  { value: 'system', label: '系统' },
  { value: 'user', label: '用户' },
  { value: 'assistant', label: '助手' },
]

const POSITION_OPTIONS: { value: PromptPosition; label: string }[] = [
  { value: 'relative', label: '相对位置' },
  { value: 'in-chat', label: '聊天内' },
]

const TRIGGER_OPTIONS: { value: PromptTrigger; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'continue', label: '继续' },
  { value: 'impersonate', label: '扮演' },
  { value: 'swipe', label: '滑动' },
  { value: 'regenerate', label: '重新生成' },
  { value: 'quiet', label: '安静' },
]

// 注入触发选项
const INJECTION_TRIGGER_OPTIONS: { value: string; label: string }[] = [
  { value: 'continue', label: '继续生成' },
  { value: 'impersonate', label: '扮演模式' },
  { value: 'swipe', label: '滑动切换' },
  { value: 'regenerate', label: '重新生成' },
  { value: 'quiet', label: '安静模式' },
]

export function PromptEditorDialog({ prompt, open, onOpenChange, onSave }: PromptEditorDialogProps) {
  const [formData, setFormData] = useState<PromptItem>(() => ({
    ...prompt,
    marker: prompt.marker ?? false,
    injectionOrder: prompt.injectionOrder ?? 100,
    injectionTrigger: prompt.injectionTrigger ?? [],
  }))

  useEffect(() => {
    setFormData({
      ...prompt,
      marker: prompt.marker ?? false,
      injectionOrder: prompt.injectionOrder ?? 100,
      injectionTrigger: prompt.injectionTrigger ?? [],
    })
  }, [prompt])

  const handleSave = () => {
    onSave(formData)
  }

  const handleTriggerToggle = (trigger: PromptTrigger, checked: boolean) => {
    if (checked) {
      setFormData({
        ...formData,
        triggers: [...formData.triggers, trigger],
      })
    } else {
      setFormData({
        ...formData,
        triggers: formData.triggers.filter((t) => t !== trigger),
      })
    }
  }

  const handleInjectionTriggerToggle = (trigger: string, checked: boolean) => {
    const currentTriggers = formData.injectionTrigger || []
    if (checked) {
      setFormData({
        ...formData,
        injectionTrigger: [...currentTriggers, trigger],
      })
    } else {
      setFormData({
        ...formData,
        injectionTrigger: currentTriggers.filter((t) => t !== trigger),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑提示词</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 名称 */}
          <div className="space-y-2">
            <Label htmlFor="name">名称</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="提示词名称"
            />
          </div>

          {/* 角色 */}
          <div className="space-y-2">
            <Label>角色</Label>
            <Select
              value={formData.role}
              onValueChange={(value: PromptRole) =>
                setFormData({ ...formData, role: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 内容 */}
          <div className="space-y-2">
            <Label htmlFor="content">内容</Label>
            <Textarea
              id="content"
              value={formData.content}
              onChange={(e) =>
                setFormData({ ...formData, content: e.target.value })
              }
              placeholder="提示词内容..."
              className="min-h-[150px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持宏变量: {'{{char}}'}, {'{{user}}'}, {'{{scenario}}'} 等
            </p>
          </div>

          {/* 位置 */}
          <div className="space-y-2">
            <Label>位置</Label>
            <Select
              value={formData.position}
              onValueChange={(value: PromptPosition) =>
                setFormData({ ...formData, position: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 深度 (仅当位置为 in-chat 时显示) */}
          {formData.position === 'in-chat' && (
            <div className="space-y-2">
              <Label htmlFor="depth">深度</Label>
              <Input
                id="depth"
                type="number"
                value={formData.depth}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    depth: parseInt(e.target.value) || 0,
                  })
                }
                min={0}
                max={999}
              />
              <p className="text-xs text-muted-foreground">
                0 = 最后一条消息之后，数字越大位置越靠前
              </p>
            </div>
          )}

          {/* 触发类型 */}
          <div className="space-y-2">
            <Label>触发类型</Label>
            <div className="flex flex-wrap gap-3">
              {TRIGGER_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`trigger-${option.value}`}
                    checked={formData.triggers.includes(option.value)}
                    onCheckedChange={(checked) =>
                      handleTriggerToggle(option.value, checked as boolean)
                    }
                  />
                  <label
                    htmlFor={`trigger-${option.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* 禁止覆盖 */}
          <div className="flex items-center justify-between">
            <div>
              <Label>禁止覆盖</Label>
              <p className="text-xs text-muted-foreground">
                防止角色卡覆盖此提示词
              </p>
            </div>
            <Switch
              checked={formData.forbidOverrides}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, forbidOverrides: checked })
              }
            />
          </div>

          {/* 标记提示词 */}
          <div className="flex items-center justify-between">
            <div>
              <Label>标记提示词</Label>
              <p className="text-xs text-muted-foreground">
                标记为系统内置的特殊提示词槽位
              </p>
            </div>
            <Switch
              checked={formData.marker}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, marker: checked })
              }
            />
          </div>

          {/* 注入顺序 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>注入顺序</Label>
                <p className="text-xs text-muted-foreground">
                  同深度下的插入优先级，数字越小优先级越高
                </p>
              </div>
              <Input
                type="number"
                value={formData.injectionOrder}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    injectionOrder: parseInt(e.target.value) || 100,
                  })
                }
                className="w-24 h-8 text-right"
                min={0}
                max={9999}
              />
            </div>
          </div>

          {/* 注入触发条件 */}
          <div className="space-y-2">
            <Label>注入触发条件</Label>
            <p className="text-xs text-muted-foreground mb-2">
              选择在哪些情况下注入此提示词（留空表示始终注入）
            </p>
            <div className="flex flex-wrap gap-3">
              {INJECTION_TRIGGER_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`injection-${option.value}`}
                    checked={(formData.injectionTrigger || []).includes(option.value)}
                    onCheckedChange={(checked) =>
                      handleInjectionTriggerToggle(option.value, checked as boolean)
                    }
                  />
                  <label
                    htmlFor={`injection-${option.value}`}
                    className="text-sm cursor-pointer"
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
