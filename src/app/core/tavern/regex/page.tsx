'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { 
  ArrowLeft, Plus, Code, Search, Settings2, 
  Download, Upload, Trash2, MoreVertical, GripVertical,
  User, Settings, ChevronRight
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { 
  TavernRegex, 
  TavernCard,
  TavernPreset,
  getRegexScripts, 
  insertRegex,
  deleteRegex,
  updateRegex,
  getCards,
  getPresets,
} from '@/db/tavern'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'

// 正则应用位置
const REGEX_PLACEMENT = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
}

const PLACEMENT_LABELS: Record<number, string> = {
  [REGEX_PLACEMENT.USER_INPUT]: '用户输入',
  [REGEX_PLACEMENT.AI_OUTPUT]: 'AI输出',
  [REGEX_PLACEMENT.SLASH_COMMAND]: '斜杠命令',
  [REGEX_PLACEMENT.WORLD_INFO]: '世界书',
  [REGEX_PLACEMENT.REASONING]: '推理',
}

type TabType = 'global' | 'character' | 'preset'

export default function RegexPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  const [regexScripts, setRegexScripts] = useState<TavernRegex[]>([])
  const [cards, setCards] = useState<TavernCard[]>([])
  const [presets, setPresets] = useState<TavernPreset[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('global')
  const [selectedScript, setSelectedScript] = useState<TavernRegex | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    loadRegexScripts()
    loadCards()
    loadPresets()
  }, [])

  const loadRegexScripts = async () => {
    const data = await getRegexScripts()
    setRegexScripts(data)
  }

  const loadCards = async () => {
    const data = await getCards()
    setCards(data)
  }

  const loadPresets = async () => {
    const data = await getPresets()
    setPresets(data)
  }

  // 按类型筛选脚本
  const getScriptsByType = (type: TabType) => {
    switch (type) {
      case 'global':
        return regexScripts.filter(r => !r.cardId && !r.presetId)
      case 'character':
        if (!selectedCardId) return []
        return regexScripts.filter(r => r.cardId === selectedCardId)
      case 'preset':
        if (!selectedPresetId) return []
        return regexScripts.filter(r => r.presetId === selectedPresetId)
    }
  }

  const filteredScripts = getScriptsByType(activeTab).filter(script =>
    (script.name || script.scriptName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    script.findRegex.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 获取选中的角色
  const selectedCard = cards.find(c => c.id === selectedCardId)
  const selectedPreset = presets.find(p => p.id === selectedPresetId)

  // 切换脚本启用状态
  const handleToggleScript = async (script: TavernRegex) => {
    try {
      await updateRegex(script.id, { disabled: !script.disabled })
      await loadRegexScripts()
    } catch (error) {
      console.error('切换脚本状态失败:', error)
      toast({ description: '操作失败', variant: 'destructive' })
    }
  }

  // 删除脚本
  const handleDelete = async (script: TavernRegex) => {
    if (!confirm(`确定删除正则脚本 "${script.name || script.scriptName}" 吗？`)) return
    
    try {
      await deleteRegex(script.id)
      toast({ description: '删除成功' })
      if (selectedScript?.id === script.id) {
        setSelectedScript(null)
      }
      await loadRegexScripts()
    } catch (error) {
      console.error('删除正则脚本失败:', error)
      toast({ description: '删除失败', variant: 'destructive' })
    }
  }

  // 导出脚本
  const handleExport = async (script: TavernRegex) => {
    try {
      const exportData = {
        scriptName: script.scriptName,
        findRegex: script.findRegex,
        replaceString: script.replaceString,
        trimStrings: JSON.parse(script.trimStrings || '[]'),
        placement: JSON.parse(script.placement || '[]'),
        disabled: script.disabled,
        markdownOnly: script.markdownOnly,
        promptOnly: script.promptOnly,
        runOnEdit: script.runOnEdit,
        substituteRegex: script.substituteRegex,
        minDepth: script.minDepth,
        maxDepth: script.maxDepth,
      }

      const filePath = await saveDialog({
        defaultPath: `regex-${script.scriptName || script.name || 'script'}.json`,
        filters: [{ name: '正则脚本', extensions: ['json'] }],
      })

      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(exportData, null, 2))
        toast({ description: '导出成功' })
      }
    } catch (error) {
      console.error('导出正则脚本失败:', error)
      toast({ description: '导出失败', variant: 'destructive' })
    }
  }

  // 导入脚本
  const handleImport = async () => {
    // 角色正则必须先选择角色
    if (activeTab === 'character' && !selectedCardId) {
      toast({ description: '请先选择角色', variant: 'destructive' })
      return
    }
    // 预设正则必须先选择预设
    if (activeTab === 'preset' && !selectedPresetId) {
      toast({ description: '请先选择预设', variant: 'destructive' })
      return
    }

    try {
      setImporting(true)
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: '正则脚本', extensions: ['json'] }],
      })

      if (!selected) return

      const files = Array.isArray(selected) ? selected : [selected]
      let importCount = 0

      for (const filePath of files) {
        try {
          const content = await readTextFile(filePath)
          const data = JSON.parse(content)
          
          // 支持单个或数组格式
          const scripts = Array.isArray(data) ? data : [data]
          
          for (const script of scripts) {
            await insertRegex({
              name: script.scriptName || script.name || '导入的脚本',
              scriptName: script.scriptName || script.name || '导入的脚本',
              findRegex: script.findRegex || '',
              replaceString: script.replaceString || '',
              trimStrings: JSON.stringify(script.trimStrings || []),
              placement: JSON.stringify(script.placement || [REGEX_PLACEMENT.AI_OUTPUT]),
              disabled: script.disabled ?? false,
              markdownOnly: script.markdownOnly ?? false,
              promptOnly: script.promptOnly ?? false,
              runOnEdit: script.runOnEdit ?? true,
              substituteRegex: script.substituteRegex ?? false,
              minDepth: script.minDepth ?? null,
              maxDepth: script.maxDepth ?? null,
              cardId: activeTab === 'character' ? selectedCardId : null,
              presetId: activeTab === 'preset' ? selectedPresetId : null,
            })
            importCount++
          }
        } catch (e) {
          console.error('解析文件失败:', filePath, e)
        }
      }

      if (importCount > 0) {
        toast({ description: `导入成功：${importCount} 个脚本` })
        await loadRegexScripts()
      }
    } catch (error) {
      console.error('导入正则脚本失败:', error)
      toast({ description: '导入失败', variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  // 创建新脚本
  const handleCreate = async () => {
    // 角色正则必须先选择角色
    if (activeTab === 'character' && !selectedCardId) {
      toast({ description: '请先选择角色', variant: 'destructive' })
      return
    }
    // 预设正则必须先选择预设
    if (activeTab === 'preset' && !selectedPresetId) {
      toast({ description: '请先选择预设', variant: 'destructive' })
      return
    }

    try {
      await insertRegex({
        name: '新建正则脚本',
        scriptName: '新建正则脚本',
        findRegex: '',
        replaceString: '',
        trimStrings: '[]',
        placement: JSON.stringify([REGEX_PLACEMENT.AI_OUTPUT]),
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: false,
        minDepth: null,
        maxDepth: null,
        cardId: activeTab === 'character' ? selectedCardId : null,
        presetId: activeTab === 'preset' ? selectedPresetId : null,
      })
      toast({ description: '创建成功' })
      await loadRegexScripts()
    } catch (error) {
      console.error('创建正则脚本失败:', error)
      toast({ description: '创建失败', variant: 'destructive' })
    }
  }

  // 切换 Tab 时重置选中
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setSelectedScript(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">正则脚本</h1>
          <p className="text-sm text-muted-foreground">管理文本替换和处理规则</p>
        </div>
        <Button variant="outline" onClick={handleImport} disabled={importing}>
          <Upload className="h-4 w-4 mr-2" />
          导入
        </Button>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          新建
        </Button>
      </div>

      {/* Tab 切换 */}
      <div className="px-4 pt-3">
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabType)}>
          <TabsList className="w-full">
            <TabsTrigger value="global" className="flex-1">全局正则</TabsTrigger>
            <TabsTrigger value="character" className="flex-1">角色正则</TabsTrigger>
            <TabsTrigger value="preset" className="flex-1">预设正则</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 双栏布局 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧：脚本列表 */}
        <div className="w-72 border-r border-border flex flex-col">
          {/* 角色/预设选择器 */}
          {activeTab === 'character' && (
            <div className="p-3 border-b border-border">
              {selectedCard ? (
                <div 
                  className="flex items-center gap-2 p-2 rounded-lg bg-accent cursor-pointer"
                  onClick={() => setSelectedCardId(null)}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={selectedCard.avatarPath ? convertFileSrc(selectedCard.avatarPath) : undefined} />
                    <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{selectedCard.name}</div>
                    <div className="text-xs text-muted-foreground">点击切换角色</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-2">
                  请选择一个角色
                </div>
              )}
            </div>
          )}
          {activeTab === 'preset' && (
            <div className="p-3 border-b border-border">
              {selectedPreset ? (
                <div 
                  className="flex items-center gap-2 p-2 rounded-lg bg-accent cursor-pointer"
                  onClick={() => setSelectedPresetId(null)}
                >
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                    <Settings className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{selectedPreset.name}</div>
                    <div className="text-xs text-muted-foreground">点击切换预设</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-2">
                  请选择一个预设
                </div>
              )}
            </div>
          )}

          {/* 搜索 */}
          {(activeTab === 'global' || (activeTab === 'character' && selectedCardId) || (activeTab === 'preset' && selectedPresetId)) && (
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索脚本..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </div>
          )}

          {/* 列表 */}
          <ScrollArea className="flex-1">
            {/* 角色选择列表 */}
            {activeTab === 'character' && !selectedCardId && (
              <div className="p-2 space-y-1">
                {cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <User className="h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">暂无角色</p>
                  </div>
                ) : (
                  cards.map((card) => (
                    <div
                      key={card.id}
                      className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setSelectedCardId(card.id)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={card.avatarPath ? convertFileSrc(card.avatarPath) : undefined} />
                        <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{card.name}</div>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {regexScripts.filter(r => r.cardId === card.id).length}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 预设选择列表 */}
            {activeTab === 'preset' && !selectedPresetId && (
              <div className="p-2 space-y-1">
                {presets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Settings className="h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">暂无预设</p>
                  </div>
                ) : (
                  presets.map((preset) => (
                    <div
                      key={preset.id}
                      className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setSelectedPresetId(preset.id)}
                    >
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                        <Settings className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{preset.name}</div>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {regexScripts.filter(r => r.presetId === preset.id).length}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 脚本列表 */}
            {(activeTab === 'global' || (activeTab === 'character' && selectedCardId) || (activeTab === 'preset' && selectedPresetId)) && (
              <div className="p-2 space-y-1">
                {filteredScripts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Code className="h-10 w-10 mb-2 opacity-50" />
                    <p className="text-sm">暂无正则脚本</p>
                    <p className="text-xs mt-1">点击新建或导入</p>
                  </div>
                ) : (
                  filteredScripts.map((script) => (
                    <div
                      key={script.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg cursor-pointer group",
                        "hover:bg-accent/50 transition-colors",
                        selectedScript?.id === script.id && "bg-accent"
                      )}
                      onClick={() => setSelectedScript(script)}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "text-sm truncate",
                          script.disabled && "opacity-50"
                        )}>
                          {script.name || script.scriptName || '未命名脚本'}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {script.findRegex || '无正则表达式'}
                        </div>
                      </div>
                      <Switch
                        checked={!script.disabled}
                        onCheckedChange={() => handleToggleScript(script)}
                        onClick={(e) => e.stopPropagation()}
                        className="scale-75"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleExport(script)}>
                            <Download className="h-4 w-4 mr-2" />
                            导出
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => handleDelete(script)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 右侧：脚本详情/编辑 */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedScript ? (
            <RegexEditor 
              script={selectedScript} 
              onSave={async () => {
                await loadRegexScripts()
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                {activeTab === 'character' && !selectedCardId ? (
                  <>
                    <User className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p>请先选择一个角色</p>
                  </>
                ) : activeTab === 'preset' && !selectedPresetId ? (
                  <>
                    <Settings className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p>请先选择一个预设</p>
                  </>
                ) : (
                  <>
                    <Code className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p>选择一个脚本进行编辑</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 正则编辑器组件
function RegexEditor({ script, onSave }: { script: TavernRegex; onSave: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState(script.scriptName || script.name || '')
  const [findRegex, setFindRegex] = useState(script.findRegex || '')
  const [replaceString, setReplaceString] = useState(script.replaceString || '')
  const [placement, setPlacement] = useState<number[]>(
    JSON.parse(script.placement || '[]')
  )
  const [markdownOnly, setMarkdownOnly] = useState(script.markdownOnly)
  const [promptOnly, setPromptOnly] = useState(script.promptOnly)
  const [runOnEdit, setRunOnEdit] = useState(script.runOnEdit)
  const [testInput, setTestInput] = useState('')
  const [testOutput, setTestOutput] = useState('')

  // 当脚本变化时重置表单
  useEffect(() => {
    setName(script.scriptName || script.name || '')
    setFindRegex(script.findRegex || '')
    setReplaceString(script.replaceString || '')
    setPlacement(JSON.parse(script.placement || '[]'))
    setMarkdownOnly(script.markdownOnly)
    setPromptOnly(script.promptOnly)
    setRunOnEdit(script.runOnEdit)
    setTestInput('')
    setTestOutput('')
  }, [script.id])

  // 测试正则
  const handleTest = () => {
    try {
      if (!findRegex || !testInput) {
        setTestOutput('')
        return
      }
      const regex = new RegExp(findRegex, 'g')
      const result = testInput.replace(regex, replaceString)
      setTestOutput(result)
    } catch (e) {
      setTestOutput(`错误: ${e instanceof Error ? e.message : '无效的正则表达式'}`)
    }
  }

  // 保存
  const handleSave = async () => {
    try {
      await updateRegex(script.id, {
        name,
        scriptName: name,
        findRegex,
        replaceString,
        placement: JSON.stringify(placement),
        markdownOnly,
        promptOnly,
        runOnEdit,
      })
      toast({ description: '保存成功' })
      onSave()
    } catch (error) {
      console.error('保存正则脚本失败:', error)
      toast({ description: '保存失败', variant: 'destructive' })
    }
  }

  // 切换应用位置
  const togglePlacement = (p: number) => {
    if (placement.includes(p)) {
      setPlacement(placement.filter(x => x !== p))
    } else {
      setPlacement([...placement, p])
    }
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* 脚本名称 */}
        <div>
          <label className="text-sm font-medium">脚本名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入脚本名称"
            className="mt-1"
          />
        </div>

        {/* 查找正则 */}
        <div>
          <label className="text-sm font-medium">查找正则表达式</label>
          <Input
            value={findRegex}
            onChange={(e) => setFindRegex(e.target.value)}
            placeholder="/pattern/flags 或 pattern"
            className="mt-1 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            支持 JavaScript 正则语法，如 /hello/gi
          </p>
        </div>

        {/* 替换字符串 */}
        <div>
          <label className="text-sm font-medium">替换内容</label>
          <Input
            value={replaceString}
            onChange={(e) => setReplaceString(e.target.value)}
            placeholder="替换文本，支持 $1, $2 等捕获组"
            className="mt-1 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            使用 $1, $2 引用捕获组，$& 引用整个匹配
          </p>
        </div>

        {/* 应用位置 */}
        <div>
          <label className="text-sm font-medium mb-2 block">应用位置</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PLACEMENT_LABELS).map(([key, label]) => {
              const p = Number(key)
              return (
                <Badge
                  key={p}
                  variant={placement.includes(p) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => togglePlacement(p)}
                >
                  {label}
                </Badge>
              )
            })}
          </div>
        </div>

        {/* 选项 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={markdownOnly}
              onCheckedChange={setMarkdownOnly}
            />
            <span className="text-sm">仅 Markdown</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={promptOnly}
              onCheckedChange={setPromptOnly}
            />
            <span className="text-sm">仅提示词</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={runOnEdit}
              onCheckedChange={setRunOnEdit}
            />
            <span className="text-sm">编辑时运行</span>
          </div>
        </div>

        {/* 测试区域 */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">测试</label>
              <Button size="sm" variant="outline" onClick={handleTest}>
                运行测试
              </Button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">输入</label>
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="输入测试文本..."
                className="w-full h-20 mt-1 p-2 text-sm rounded-md border bg-background resize-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">输出</label>
              <div className="w-full h-20 mt-1 p-2 text-sm rounded-md border bg-muted overflow-auto whitespace-pre-wrap">
                {testOutput || <span className="text-muted-foreground">输出将显示在这里</span>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <Button onClick={handleSave}>
            <Settings2 className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
