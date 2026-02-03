'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowLeft, Save, Trash2, Plus, X, MoreVertical, Download, Upload, RotateCcw } from 'lucide-react'
import { TavernPreset, updatePreset, restorePresetToDefault, savePresetRestorePoint } from '@/db/tavern'
import { 
  CompletionPresetData, 
  createDefaultCompletionPreset,
  CharacterNameBehavior,
  ContinuePostfix,
  ImageQuality,
  ReasoningEffort,
  Verbosity,
  LogitBiasEntry,
  RegexScript,
  DEFAULT_PREFILL_SETTINGS,
  DEFAULT_PROMPT_ORDER,
} from '@/lib/tavern/preset-types'
import { importSTPreset, stringifySTPreset, parseSTPresetJSON } from '@/lib/tavern/preset-converter'
import { SamplingParams } from './sampling-params'
import { PromptManager } from './prompt-manager'
import { RegexScriptEditor } from './regex-script-editor'
import { useToast } from '@/hooks/use-toast'

interface CompletionPresetEditorProps {
  preset: TavernPreset
  onBack: () => void
  onSaved: () => void
  onDelete: () => void
}

export function CompletionPresetEditor({ preset, onBack, onSaved, onDelete }: CompletionPresetEditorProps) {
  const { toast } = useToast()
  const [name, setName] = useState(preset.name)
  const [data, setData] = useState<CompletionPresetData>(() => {
    try {
      const parsed = JSON.parse(preset.data) as CompletionPresetData
      // 确保新字段有默认值（向后兼容）
      return {
        ...createDefaultCompletionPreset(),
        ...parsed,
        basic: { ...createDefaultCompletionPreset().basic, ...parsed.basic },
        prefill: parsed.prefill || DEFAULT_PREFILL_SETTINGS,
        promptOrder: parsed.promptOrder || DEFAULT_PROMPT_ORDER,
        regexScripts: parsed.regexScripts || [],
      }
    } catch {
      return createDefaultCompletionPreset()
    }
  })
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updatePreset(preset.id, {
        name,
        data: JSON.stringify(data),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const updateData = (updates: Partial<CompletionPresetData>) => {
    setData(prev => ({ ...prev, ...updates }))
  }

  // 导出为 ST 格式 JSON
  const handleExport = () => {
    try {
      const jsonString = stringifySTPreset(data)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'preset'}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ title: '预设已导出' })
    } catch (error) {
      toast({ title: '导出失败', variant: 'destructive' })
      console.error('Export error:', error)
    }
  }

  // 从 ST 格式 JSON 导入
  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const stPreset = parseSTPresetJSON(content)
        if (!stPreset) {
          toast({ title: '无效的预设文件', variant: 'destructive' })
          return
        }
        const importedData = importSTPreset(stPreset)
        setData(importedData)
        toast({ title: '预设已导入' })
      } catch (error) {
        toast({ title: '导入失败: 文件格式错误', variant: 'destructive' })
        console.error('Import error:', error)
      }
    }
    reader.readAsText(file)
    // 重置 input 以允许再次选择相同文件
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 恢复预设到默认值
  const handleRestore = async () => {
    const success = await restorePresetToDefault(preset.id)
    if (success) {
      // 重新加载数据
      try {
        const { getPresetById } = await import('@/db/tavern')
        const updatedPreset = await getPresetById(preset.id)
        if (updatedPreset) {
          const parsed = JSON.parse(updatedPreset.data) as CompletionPresetData
          setData({
            ...createDefaultCompletionPreset(),
            ...parsed,
            basic: { ...createDefaultCompletionPreset().basic, ...parsed.basic },
            prefill: parsed.prefill || DEFAULT_PREFILL_SETTINGS,
            promptOrder: parsed.promptOrder || DEFAULT_PROMPT_ORDER,
            regexScripts: parsed.regexScripts || [],
          })
        }
      } catch {
        // 回退到默认值
        setData(createDefaultCompletionPreset())
      }
      toast({ title: '已恢复到默认值' })
    } else {
      toast({ title: '无法恢复：没有可用的默认数据', variant: 'destructive' })
    }
  }

  // 保存当前状态为恢复点
  const handleSaveRestorePoint = async () => {
    // 先保存当前编辑
    await updatePreset(preset.id, {
      name,
      data: JSON.stringify(data),
    })
    // 再设置恢复点
    const success = await savePresetRestorePoint(preset.id)
    if (success) {
      toast({ title: '已保存为恢复点' })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-lg font-semibold h-8 px-2 -ml-2"
            placeholder="预设名称"
          />
        </div>
        <div className="flex gap-2">
          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          
          {/* 更多操作下拉菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                导入 ST 预设
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                导出为 ST 格式
              </DropdownMenuItem>
              {preset.originalData && (
                <DropdownMenuItem onClick={handleRestore}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  恢复默认
                </DropdownMenuItem>
              )}
              {!preset.isDefault && (
                <DropdownMenuItem onClick={handleSaveRestorePoint}>
                  <Save className="h-4 w-4 mr-2" />
                  保存为恢复点
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {!preset.isDefault && (
            <Button variant="outline" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* 主体内容 */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <Accordion type="multiple" defaultValue={['basic', 'sampling', 'prompts']} className="space-y-2">
            {/* 基础设置 */}
            <AccordionItem value="basic" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">基础设置</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="space-y-4">
                  {/* 上下文长度 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>上下文长度</Label>
                      <Input
                        type="number"
                        value={data.basic.maxContext}
                        onChange={(e) => updateData({
                          basic: { ...data.basic, maxContext: parseInt(e.target.value) || 4096 }
                        })}
                        className="w-24 h-8 text-right"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">发送给 AI 的最大 token 数量</p>
                  </div>

                  {/* 解锁上下文长度 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>解锁上下文长度</Label>
                      <p className="text-xs text-muted-foreground">允许使用超出模型默认限制的上下文长度</p>
                    </div>
                    <Switch
                      checked={data.basic.unlockContext}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, unlockContext: checked }
                      })}
                    />
                  </div>

                  {/* 最大回复长度 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>最大回复长度</Label>
                      <Input
                        type="number"
                        value={data.basic.maxResponse}
                        onChange={(e) => updateData({
                          basic: { ...data.basic, maxResponse: parseInt(e.target.value) || 300 }
                        })}
                        className="w-24 h-8 text-right"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">AI 回复的最大 token 数量</p>
                  </div>

                  {/* 候选数 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>每次生成候选数 (n)</Label>
                      <Input
                        type="number"
                        value={data.basic.candidateCount}
                        onChange={(e) => updateData({
                          basic: { ...data.basic, candidateCount: parseInt(e.target.value) || 1 }
                        })}
                        className="w-24 h-8 text-right"
                        min={1}
                        max={10}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">同时生成多个回复供选择</p>
                  </div>

                  {/* 流式传输 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>流式传输</Label>
                      <p className="text-xs text-muted-foreground">实时显示生成内容</p>
                    </div>
                    <Switch
                      checked={data.basic.streaming}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, streaming: checked }
                      })}
                    />
                  </div>

                  {/* 种子 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>种子</Label>
                      <Input
                        type="number"
                        value={data.basic.seed}
                        onChange={(e) => updateData({
                          basic: { ...data.basic, seed: parseInt(e.target.value) || -1 }
                        })}
                        className="w-32 h-8 text-right"
                        min={-1}
                        max={2147483647}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">-1 表示随机种子</p>
                  </div>

                  {/* 使用系统提示词 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>使用系统提示词</Label>
                      <p className="text-xs text-muted-foreground">允许系统提示词发送到 AI</p>
                    </div>
                    <Switch
                      checked={data.basic.useSysPrompt}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, useSysPrompt: checked }
                      })}
                    />
                  </div>

                  {/* 显示思考过程 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>显示思考过程</Label>
                      <p className="text-xs text-muted-foreground">显示 AI 的思考/推理过程</p>
                    </div>
                    <Switch
                      checked={data.basic.showThoughts}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, showThoughts: checked }
                      })}
                    />
                  </div>

                  {/* 启用网络搜索 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>启用网络搜索</Label>
                      <p className="text-xs text-muted-foreground">允许 AI 搜索网络信息</p>
                    </div>
                    <Switch
                      checked={data.basic.enableWebSearch}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, enableWebSearch: checked }
                      })}
                    />
                  </div>

                  {/* 请求生成图片 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>请求生成图片</Label>
                      <p className="text-xs text-muted-foreground">允许 AI 生成图片</p>
                    </div>
                    <Switch
                      checked={data.basic.requestImages}
                      onCheckedChange={(checked) => updateData({
                        basic: { ...data.basic, requestImages: checked }
                      })}
                    />
                  </div>

                  {/* 图片宽高比 */}
                  {data.basic.requestImages && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>图片宽高比</Label>
                        <Input
                          value={data.basic.requestImageAspectRatio}
                          onChange={(e) => updateData({
                            basic: { ...data.basic, requestImageAspectRatio: e.target.value }
                          })}
                          placeholder="例如: 16:9"
                          className="w-32 h-8 text-right"
                        />
                      </div>
                    </div>
                  )}

                  {/* 图片分辨率 */}
                  {data.basic.requestImages && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>图片分辨率</Label>
                        <Input
                          value={data.basic.requestImageResolution}
                          onChange={(e) => updateData({
                            basic: { ...data.basic, requestImageResolution: e.target.value }
                          })}
                          placeholder="例如: 1024x768"
                          className="w-32 h-8 text-right"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 预填充设置 */}
            <AccordionItem value="prefill" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">预填充设置</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="space-y-4">
                  {/* Assistant预填充 */}
                  <div className="space-y-2">
                    <Label>Assistant预填充</Label>
                    <Textarea
                      value={data.prefill?.assistantPrefill || ''}
                      onChange={(e) => updateData({
                        prefill: { ...data.prefill, assistantPrefill: e.target.value }
                      })}
                      placeholder="AI 回复的开头内容..."
                      className="min-h-[60px] font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">预填充到 AI 回复开头的内容</p>
                  </div>

                  {/* 扮演预填充 */}
                  <div className="space-y-2">
                    <Label>扮演预填充</Label>
                    <Textarea
                      value={data.prefill?.assistantImpersonation || ''}
                      onChange={(e) => updateData({
                        prefill: { ...data.prefill, assistantImpersonation: e.target.value }
                      })}
                      placeholder="扮演模式的预填充内容..."
                      className="min-h-[60px] font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">扮演模式下的预填充内容</p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 采样参数 */}
            <AccordionItem value="sampling" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">采样参数</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <SamplingParams 
                  params={data.sampling}
                  onChange={(sampling) => updateData({ sampling })}
                />
              </AccordionContent>
            </AccordionItem>

            {/* 行为设置 */}
            <AccordionItem value="behavior" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">行为设置</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="space-y-4">
                  {/* 角色名称行为 */}
                  <div className="space-y-2">
                    <Label>角色名称行为</Label>
                    <RadioGroup
                      value={data.behavior.characterNameBehavior}
                      onValueChange={(value: CharacterNameBehavior) => updateData({
                        behavior: { ...data.behavior, characterNameBehavior: value }
                      })}
                      className="grid grid-cols-2 gap-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="none" id="name-none" />
                        <Label htmlFor="name-none" className="text-sm font-normal">无</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="default" id="name-default" />
                        <Label htmlFor="name-default" className="text-sm font-normal">默认</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="completion" id="name-completion" />
                        <Label htmlFor="name-completion" className="text-sm font-normal">补全对象</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="content" id="name-content" />
                        <Label htmlFor="name-content" className="text-sm font-normal">消息内容</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* 继续后缀 */}
                  <div className="space-y-2">
                    <Label>继续后缀</Label>
                    <RadioGroup
                      value={data.behavior.continuePostfix}
                      onValueChange={(value: ContinuePostfix) => updateData({
                        behavior: { ...data.behavior, continuePostfix: value }
                      })}
                      className="grid grid-cols-2 gap-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="none" id="postfix-none" />
                        <Label htmlFor="postfix-none" className="text-sm font-normal">无</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="space" id="postfix-space" />
                        <Label htmlFor="postfix-space" className="text-sm font-normal">空格</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="newline" id="postfix-newline" />
                        <Label htmlFor="postfix-newline" className="text-sm font-normal">换行</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="double_newline" id="postfix-double" />
                        <Label htmlFor="postfix-double" className="text-sm font-normal">双换行</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* 继续预填充 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>继续预填充</Label>
                      <p className="text-xs text-muted-foreground">继续生成时预填充上一条消息</p>
                    </div>
                    <Switch
                      checked={data.behavior.continuePrefill}
                      onCheckedChange={(checked) => updateData({
                        behavior: { ...data.behavior, continuePrefill: checked }
                      })}
                    />
                  </div>

                  {/* 压缩系统消息 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>压缩系统消息</Label>
                      <p className="text-xs text-muted-foreground">合并连续的系统消息</p>
                    </div>
                    <Switch
                      checked={data.behavior.squashSystemMessages}
                      onCheckedChange={(checked) => updateData({
                        behavior: { ...data.behavior, squashSystemMessages: checked }
                      })}
                    />
                  </div>

                  {/* 启用函数调用 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>启用函数调用</Label>
                      <p className="text-xs text-muted-foreground">允许 AI 调用定义的函数</p>
                    </div>
                    <Switch
                      checked={data.behavior.enableFunctionCalling}
                      onCheckedChange={(checked) => updateData({
                        behavior: { ...data.behavior, enableFunctionCalling: checked }
                      })}
                    />
                  </div>

                  {/* 发送内联媒体 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>发送内联媒体</Label>
                      <p className="text-xs text-muted-foreground">在消息中包含图片等媒体</p>
                    </div>
                    <Switch
                      checked={data.behavior.sendInlineMedia}
                      onCheckedChange={(checked) => updateData({
                        behavior: { ...data.behavior, sendInlineMedia: checked }
                      })}
                    />
                  </div>

                  {/* 图片画质 */}
                  <div className="flex items-center justify-between">
                    <Label>图片画质</Label>
                    <Select
                      value={data.behavior.imageQuality}
                      onValueChange={(value: ImageQuality) => updateData({
                        behavior: { ...data.behavior, imageQuality: value }
                      })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动</SelectItem>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 推理强度 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>推理强度</Label>
                      <p className="text-xs text-muted-foreground">OpenAI 风格参数</p>
                    </div>
                    <Select
                      value={data.behavior.reasoningEffort}
                      onValueChange={(value: ReasoningEffort) => updateData({
                        behavior: { ...data.behavior, reasoningEffort: value }
                      })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动</SelectItem>
                        <SelectItem value="min">极低</SelectItem>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                        <SelectItem value="max">极高</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Verbosity */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Verbosity</Label>
                      <p className="text-xs text-muted-foreground">回复详细程度</p>
                    </div>
                    <Select
                      value={data.behavior.verbosity}
                      onValueChange={(value: Verbosity) => updateData({
                        behavior: { ...data.behavior, verbosity: value }
                      })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动</SelectItem>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 快速提示词编辑 */}
            <AccordionItem value="quickPrompts" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">快速提示词编辑</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="space-y-4">
                  {/* 主要 */}
                  <div className="space-y-2">
                    <Label>主要</Label>
                    <Textarea
                      value={data.quickPrompts.main}
                      onChange={(e) => updateData({
                        quickPrompts: { ...data.quickPrompts, main: e.target.value }
                      })}
                      placeholder="Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}."
                      className="min-h-[80px] font-mono text-sm"
                    />
                  </div>

                  {/* 辅助的 */}
                  <div className="space-y-2">
                    <Label>辅助的</Label>
                    <Textarea
                      value={data.quickPrompts.auxiliary}
                      onChange={(e) => updateData({
                        quickPrompts: { ...data.quickPrompts, auxiliary: e.target.value }
                      })}
                      placeholder="—"
                      className="min-h-[60px] font-mono text-sm"
                    />
                  </div>

                  {/* 后续历史指令 */}
                  <div className="space-y-2">
                    <Label>后续历史指令</Label>
                    <Textarea
                      value={data.quickPrompts.postHistoryInstructions}
                      onChange={(e) => updateData({
                        quickPrompts: { ...data.quickPrompts, postHistoryInstructions: e.target.value }
                      })}
                      placeholder="—"
                      className="min-h-[60px] font-mono text-sm"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 实用提示词 */}
            <AccordionItem value="utilityPrompts" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">实用提示词</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <div className="space-y-4">
                  {/* AI帮答提示词 */}
                  <div className="space-y-2">
                    <Label>AI帮答提示词</Label>
                    <Textarea
                      value={data.utilityPrompts.impersonation}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, impersonation: e.target.value }
                      })}
                      className="min-h-[60px] font-mono text-sm"
                    />
                  </div>

                  {/* 世界信息格式模板 */}
                  <div className="space-y-2">
                    <Label>世界信息格式模板</Label>
                    <Input
                      value={data.utilityPrompts.worldInfoFormat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, worldInfoFormat: e.target.value }
                      })}
                      placeholder="{0}"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">使用 {'{0}'} 标记插入位置</p>
                  </div>

                  {/* 场景格式模板 */}
                  <div className="space-y-2">
                    <Label>场景格式模板</Label>
                    <Input
                      value={data.utilityPrompts.scenarioFormat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, scenarioFormat: e.target.value }
                      })}
                      placeholder="{{scenario}}"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 角色设定格式模板 */}
                  <div className="space-y-2">
                    <Label>角色设定格式模板</Label>
                    <Input
                      value={data.utilityPrompts.personalityFormat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, personalityFormat: e.target.value }
                      })}
                      placeholder="{{personality}}"
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 群聊推进提示词模板 */}
                  <div className="space-y-2">
                    <Label>群聊推进提示词模板</Label>
                    <Input
                      value={data.utilityPrompts.groupNudge}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, groupNudge: e.target.value }
                      })}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 新聊天 */}
                  <div className="space-y-2">
                    <Label>新聊天</Label>
                    <Input
                      value={data.utilityPrompts.newChat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, newChat: e.target.value }
                      })}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 新群聊 */}
                  <div className="space-y-2">
                    <Label>新群聊</Label>
                    <Input
                      value={data.utilityPrompts.newGroupChat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, newGroupChat: e.target.value }
                      })}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 新示例聊天 */}
                  <div className="space-y-2">
                    <Label>新示例聊天</Label>
                    <Input
                      value={data.utilityPrompts.newExampleChat}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, newExampleChat: e.target.value }
                      })}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 继续推进 */}
                  <div className="space-y-2">
                    <Label>继续推进</Label>
                    <Input
                      value={data.utilityPrompts.continueNudge}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, continueNudge: e.target.value }
                      })}
                      className="font-mono text-sm"
                    />
                  </div>

                  {/* 替换空消息 */}
                  <div className="space-y-2">
                    <Label>替换空消息</Label>
                    <Input
                      value={data.utilityPrompts.emptyMessage}
                      onChange={(e) => updateData({
                        utilityPrompts: { ...data.utilityPrompts, emptyMessage: e.target.value }
                      })}
                      placeholder="—"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Logit 偏置 */}
            <AccordionItem value="logitBias" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">Logit 偏置</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <LogitBiasEditor
                  entries={data.logitBias}
                  onChange={(logitBias) => updateData({ logitBias })}
                />
              </AccordionContent>
            </AccordionItem>

            {/* 提示词管理器 */}
            <AccordionItem value="prompts" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">提示词管理器</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <PromptManager 
                  prompts={data.prompts}
                  promptOrder={data.promptOrder}
                  maxContext={data.basic.maxContext}
                  onChange={(prompts) => updateData({ prompts })}
                />
              </AccordionContent>
            </AccordionItem>

            {/* 正则脚本 */}
            <AccordionItem value="regexScripts" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <span className="font-medium">正则脚本</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-4">
                <RegexScriptEditor
                  scripts={data.regexScripts || []}
                  onChange={(regexScripts) => updateData({ regexScripts })}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  )
}

// Logit Bias 编辑器组件
interface LogitBiasEditorProps {
  entries: LogitBiasEntry[]
  onChange: (entries: LogitBiasEntry[]) => void
}

function LogitBiasEditor({ entries, onChange }: LogitBiasEditorProps) {
  const handleAdd = () => {
    onChange([
      ...entries,
      { id: `bias_${Date.now()}`, token: '', bias: 0 }
    ])
  }

  const handleRemove = (id: string) => {
    onChange(entries.filter(e => e.id !== id))
  }

  const handleUpdate = (id: string, field: 'token' | 'bias', value: string | number) => {
    onChange(entries.map(e => 
      e.id === id ? { ...e, [field]: value } : e
    ))
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        有助于禁止或加强某些单词的使用
      </p>
      
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2">
          <Input
            value={entry.token}
            onChange={(e) => handleUpdate(entry.id, 'token', e.target.value)}
            placeholder="Token"
            className="flex-1 font-mono text-sm"
          />
          <Input
            type="number"
            value={entry.bias}
            onChange={(e) => handleUpdate(entry.id, 'bias', parseFloat(e.target.value) || 0)}
            className="w-24 text-right"
            min={-100}
            max={100}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => handleRemove(entry.id)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={handleAdd}>
        <Plus className="h-4 w-4 mr-1" />
        添加偏置
      </Button>
    </div>
  )
}
