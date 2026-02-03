'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TavernWorldInfoEntry, updateWorldInfoEntry } from '@/db/tavern'
import { useToast } from '@/hooks/use-toast'
import {
  parseReferences,
  hasReferences,
  validateReferenceSyntax,
  extractReferencedNames,
} from '@/lib/tavern/wi-references'
import { AlertCircle, Link, CheckCircle } from 'lucide-react'

interface EntryEditorProps {
  entry: TavernWorldInfoEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /** 其他条目 (用于引用验证) */
  allEntries?: TavernWorldInfoEntry[]
}

// 选择性逻辑选项
const selectiveLogicOptions = [
  { value: 0, label: 'AND ALL - 所有次要关键词都匹配' },
  { value: 1, label: 'NOT ALL - 至少一个不匹配' },
  { value: 2, label: 'NOT ANY - 没有任何匹配' },
  { value: 3, label: 'AND ANY - 至少一个匹配' },
]

// 注入位置选项
const positionOptions = [
  { value: 0, label: '角色描述之前' },
  { value: 1, label: '角色描述之后' },
  { value: 2, label: '示例对话之前' },
  { value: 3, label: '示例对话之后' },
  { value: 4, label: '系统提示词之后' },
  { value: 5, label: '历史对话开头' },
  { value: 6, label: '深度位置' },
]

// 注入角色选项 (V3)
const roleOptions = [
  { value: 0, label: 'System' },
  { value: 1, label: 'User' },
  { value: 2, label: 'Assistant' },
]

export function EntryEditor({ entry, open, onOpenChange, onSaved, allEntries = [] }: EntryEditorProps) {
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  // 表单状态
  const [formData, setFormData] = useState({
    keys: '',
    secondaryKeys: '',
    content: '',
    comment: '',
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: 0,
    order: 0,
    position: 0,
    depth: 4,
    probability: 100,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null as number | null,
    caseSensitive: false,
    matchWholeWords: false,
    excludeRecursion: false,
    preventRecursion: false,
    // V3 高级字段
    useRegex: true,
    role: 0,
    useProbability: true,
    displayIndex: 0,
    delayUntilRecursion: false,
    sticky: null as number | null,
    cooldown: null as number | null,
    delay: null as number | null,
  })

  // 引用验证
  const referenceValidation = useMemo(() => {
    if (!formData.content) {
      return { valid: true, errors: [], references: [], missingRefs: [] }
    }
    
    // 检查语法
    const syntaxResult = validateReferenceSyntax(formData.content)
    
    // 提取引用的条目名称
    const referencedNames = extractReferencedNames(formData.content)
    
    // 检查引用的条目是否存在
    const entryNameSet = new Set<string>()
    for (const e of allEntries) {
      if (e.uid !== undefined && e.uid !== null) entryNameSet.add(String(e.uid).toLowerCase())
      if (e.comment) entryNameSet.add(e.comment.toLowerCase())
      try {
        const keys = JSON.parse(e.keys || '[]')
        if (Array.isArray(keys) && keys[0]) {
          entryNameSet.add(keys[0].toLowerCase())
        }
      } catch {}
    }
    
    const missingRefs = referencedNames.filter(name => !entryNameSet.has(name.toLowerCase()))
    
    // 检查自引用
    const selfRef = referencedNames.some(name => {
      const nameLower = name.toLowerCase()
      return (entry ? String(entry.uid).toLowerCase() : undefined) === nameLower ||
             entry?.comment?.toLowerCase() === nameLower
    })
    
    const errors = [...syntaxResult.errors]
    if (selfRef) {
      errors.push('检测到自引用，可能导致循环')
    }
    
    return {
      valid: errors.length === 0 && missingRefs.length === 0,
      errors,
      references: referencedNames,
      missingRefs,
    }
  }, [formData.content, allEntries, entry])

  // 加载条目数据
  useEffect(() => {
    if (entry) {
      setFormData({
        keys: JSON.parse(entry.keys || '[]').join(', '),
        secondaryKeys: JSON.parse(entry.secondaryKeys || '[]').join(', '),
        content: entry.content || '',
        comment: entry.comment || '',
        enabled: entry.enabled,
        constant: entry.constant,
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic,
        order: entry.order,
        position: entry.position,
        depth: entry.depth,
        probability: entry.probability,
        group: entry.group || '',
        groupOverride: entry.groupOverride,
        groupWeight: entry.groupWeight,
        scanDepth: entry.scanDepth,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        excludeRecursion: entry.excludeRecursion,
        preventRecursion: entry.preventRecursion,
        useRegex: entry.useRegex ?? true,
        role: entry.role ?? 0,
        useProbability: entry.useProbability ?? true,
        displayIndex: entry.displayIndex ?? 0,
        delayUntilRecursion: entry.delayUntilRecursion ?? false,
        sticky: entry.sticky ?? null,
        cooldown: entry.cooldown ?? null,
        delay: entry.delay ?? null,
      })
    }
  }, [entry])

  // 保存
  const handleSave = async () => {
    if (!entry) return

    setIsSaving(true)
    try {
      // 解析关键词
      const keys = formData.keys.split(',').map(k => k.trim()).filter(k => k)
      const secondaryKeys = formData.secondaryKeys.split(',').map(k => k.trim()).filter(k => k)

      await updateWorldInfoEntry(entry.id, {
        keys: JSON.stringify(keys),
        secondaryKeys: JSON.stringify(secondaryKeys),
        content: formData.content,
        comment: formData.comment,
        enabled: formData.enabled,
        constant: formData.constant,
        selective: formData.selective,
        selectiveLogic: formData.selectiveLogic,
        order: formData.order,
        position: formData.position,
        depth: formData.depth,
        probability: formData.probability,
        group: formData.group,
        groupOverride: formData.groupOverride,
        groupWeight: formData.groupWeight,
        scanDepth: formData.scanDepth,
        caseSensitive: formData.caseSensitive,
        matchWholeWords: formData.matchWholeWords,
        excludeRecursion: formData.excludeRecursion,
        preventRecursion: formData.preventRecursion,
        useRegex: formData.useRegex,
        role: formData.role,
        useProbability: formData.useProbability,
        displayIndex: formData.displayIndex,
        delayUntilRecursion: formData.delayUntilRecursion,
        sticky: formData.sticky,
        cooldown: formData.cooldown,
        delay: formData.delay,
      })

      toast({ title: '保存成功' })
      onSaved()
      onOpenChange(false)
    } catch (error) {
      console.error('保存失败:', error)
      toast({ title: '保存失败', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>编辑世界书条目</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 py-4">
            {/* 基本信息 */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch
                  checked={formData.enabled}
                  onCheckedChange={(v) => setFormData(prev => ({ ...prev, enabled: v }))}
                />
              </div>

              <div className="space-y-2">
                <Label>主关键词 (逗号分隔)</Label>
                <Input
                  value={formData.keys}
                  onChange={(e) => setFormData(prev => ({ ...prev, keys: e.target.value }))}
                  placeholder="关键词1, 关键词2, ..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>内容</Label>
                  {hasReferences(formData.content) && (
                    <div className="flex items-center gap-2">
                      {referenceValidation.valid ? (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <CheckCircle className="h-3 w-3" />
                          {referenceValidation.references.length} 个引用
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertCircle className="h-3 w-3" />
                          引用问题
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <Textarea
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="条目内容...

支持引用语法:
{{ref::条目名称}} - 引用其他条目
{{include::条目名称}} - 无条件包含
{{ifvar::变量名::值::内容}} - 条件包含"
                  className="min-h-[150px] font-mono text-sm"
                />
                
                {/* 引用验证警告 */}
                {!referenceValidation.valid && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs space-y-1">
                      {referenceValidation.errors.map((err, i) => (
                        <div key={i}>{err}</div>
                      ))}
                      {referenceValidation.missingRefs.length > 0 && (
                        <div>
                          未找到引用的条目: {referenceValidation.missingRefs.join(', ')}
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                
                {/* 引用列表 */}
                {referenceValidation.references.length > 0 && referenceValidation.valid && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {referenceValidation.references.map((ref, i) => (
                      <Tooltip key={i}>
                        <TooltipTrigger>
                          <Badge variant="outline" className="text-xs gap-1">
                            <Link className="h-3 w-3" />
                            {ref}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>引用条目: {ref}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>备注 (不会发送给 AI)</Label>
                <Input
                  value={formData.comment}
                  onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="备注..."
                />
              </div>
            </div>

            {/* 触发设置 */}
            <Accordion type="multiple" defaultValue={['trigger']}>
              <AccordionItem value="trigger">
                <AccordionTrigger>触发设置</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="flex items-center justify-between">
                    <Label>常驻激活</Label>
                    <Switch
                      checked={formData.constant}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, constant: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>使用正则匹配 (V3)</Label>
                    <Switch
                      checked={formData.useRegex}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, useRegex: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>大小写敏感</Label>
                    <Switch
                      checked={formData.caseSensitive}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, caseSensitive: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>全词匹配</Label>
                    <Switch
                      checked={formData.matchWholeWords}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, matchWholeWords: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>选择性激活</Label>
                    <Switch
                      checked={formData.selective}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, selective: v }))}
                    />
                  </div>

                  {formData.selective && (
                    <>
                      <div className="space-y-2">
                        <Label>次要关键词 (逗号分隔)</Label>
                        <Input
                          value={formData.secondaryKeys}
                          onChange={(e) => setFormData(prev => ({ ...prev, secondaryKeys: e.target.value }))}
                          placeholder="次要关键词..."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>选择性逻辑</Label>
                        <Select
                          value={String(formData.selectiveLogic)}
                          onValueChange={(v) => setFormData(prev => ({ ...prev, selectiveLogic: parseInt(v) }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {selectiveLogicOptions.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between">
                    <Label>启用概率触发 (V3)</Label>
                    <Switch
                      checked={formData.useProbability}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, useProbability: v }))}
                    />
                  </div>

                  {formData.useProbability && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>触发概率</Label>
                        <span className="text-sm text-muted-foreground">{formData.probability}%</span>
                      </div>
                      <Slider
                        value={[formData.probability]}
                        onValueChange={([v]) => setFormData(prev => ({ ...prev, probability: v }))}
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="injection">
                <AccordionTrigger>注入设置</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>注入位置</Label>
                    <Select
                      value={String(formData.position)}
                      onValueChange={(v) => setFormData(prev => ({ ...prev, position: parseInt(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {positionOptions.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>注入角色 (V3)</Label>
                    <Select
                      value={String(formData.role)}
                      onValueChange={(v) => setFormData(prev => ({ ...prev, role: parseInt(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>深度</Label>
                      <Input
                        type="number"
                        value={formData.depth}
                        onChange={(e) => setFormData(prev => ({ ...prev, depth: parseInt(e.target.value) || 0 }))}
                        min={0}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>排序</Label>
                      <Input
                        type="number"
                        value={formData.order}
                        onChange={(e) => setFormData(prev => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>显示顺序 (V3)</Label>
                    <Input
                      type="number"
                      value={formData.displayIndex}
                      onChange={(e) => setFormData(prev => ({ ...prev, displayIndex: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="advanced">
                <AccordionTrigger>高级设置 (V3)</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>递归时才检查</Label>
                      <p className="text-xs text-muted-foreground">仅在递归扫描时才检查此条目</p>
                    </div>
                    <Switch
                      checked={formData.delayUntilRecursion}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, delayUntilRecursion: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>排除递归扫描</Label>
                      <p className="text-xs text-muted-foreground">此条目内容不会触发其他条目</p>
                    </div>
                    <Switch
                      checked={formData.excludeRecursion}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, excludeRecursion: v }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>阻止递归</Label>
                      <p className="text-xs text-muted-foreground">激活后停止递归扫描</p>
                    </div>
                    <Switch
                      checked={formData.preventRecursion}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, preventRecursion: v }))}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>粘性轮数</Label>
                      <Input
                        type="number"
                        value={formData.sticky ?? ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          sticky: e.target.value ? parseInt(e.target.value) : null 
                        }))}
                        placeholder="无"
                        min={0}
                      />
                      <p className="text-xs text-muted-foreground">触发后保持激活的轮数</p>
                    </div>

                    <div className="space-y-2">
                      <Label>冷却轮数</Label>
                      <Input
                        type="number"
                        value={formData.cooldown ?? ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          cooldown: e.target.value ? parseInt(e.target.value) : null 
                        }))}
                        placeholder="无"
                        min={0}
                      />
                      <p className="text-xs text-muted-foreground">触发后冷却的轮数</p>
                    </div>

                    <div className="space-y-2">
                      <Label>延迟轮数</Label>
                      <Input
                        type="number"
                        value={formData.delay ?? ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          delay: e.target.value ? parseInt(e.target.value) : null 
                        }))}
                        placeholder="无"
                        min={0}
                      />
                      <p className="text-xs text-muted-foreground">首次触发前延迟的轮数</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="group">
                <AccordionTrigger>分组设置</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>分组名称</Label>
                    <Input
                      value={formData.group}
                      onChange={(e) => setFormData(prev => ({ ...prev, group: e.target.value }))}
                      placeholder="分组名称..."
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>覆盖分组</Label>
                    <Switch
                      checked={formData.groupOverride}
                      onCheckedChange={(v) => setFormData(prev => ({ ...prev, groupOverride: v }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>分组权重</Label>
                      <span className="text-sm text-muted-foreground">{formData.groupWeight}</span>
                    </div>
                    <Slider
                      value={[formData.groupWeight]}
                      onValueChange={([v]) => setFormData(prev => ({ ...prev, groupWeight: v }))}
                      min={0}
                      max={1000}
                      step={1}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
