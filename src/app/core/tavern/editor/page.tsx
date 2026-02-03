'use client'

import { Suspense, useState, useEffect, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  X,
  Save,
  Camera,
  HelpCircle,
  Plus,
  Trash2,
  ExternalLink,
  Maximize2,
  Sparkles,
  Settings,
  FileText,
  MessageSquare,
  Tag,
  Globe,
  FolderOpen,
  Image,
  FolderCog,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react'
import {
  TavernCard,
  getCardById,
  updateCard,
  getWorldInfos,
  TavernWorldInfo,
} from '@/db/tavern'
import { waitForDbInit } from '@/db'
import { estimateTokens } from '@/lib/tavern'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { copyFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// 标签页类型
type TabType = 'basic' | 'dialogue' | 'tags' | 'worldbook' | 'manage' | 'assets'

function CharacterEditorContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cardId = searchParams.get('id')
  const { toast } = useToast()

  const [card, setCard] = useState<TavernCard | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [worldInfos, setWorldInfos] = useState<TavernWorldInfo[]>([])
  const [imageZoom, setImageZoom] = useState(100)
  const [showHtmlPreview, setShowHtmlPreview] = useState(false)

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    mesExample: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [] as string[],
    groupOnlyGreetings: [] as string[],
    tags: [] as string[],
    creator: '',
    characterVersion: '',
    avatarPath: '',
    // V3 扩展字段
    depthPromptText: '',
    depthPromptDepth: 4,
    depthPromptRole: 'system' as 'system' | 'user' | 'assistant',
    linkedWorld: '',
    talkativeness: 0.5,
    isFavorite: false,
    // 本地笔记 (不导出)
    localNote: '',
    // 来源链接
    sourceUrl: '',
  })

  // 新标签输入
  const [newTag, setNewTag] = useState('')
  const newTagInputRef = useRef<HTMLInputElement>(null)

  // 加载角色卡数据
  useEffect(() => {
    async function loadCard() {
      if (!cardId) {
        router.push('/core/tavern')
        return
      }

      try {
        await waitForDbInit()
        const cardData = await getCardById(parseInt(cardId))
        if (!cardData) {
          toast({ title: '角色卡不存在', variant: 'destructive' })
          router.push('/core/tavern')
          return
        }

        setCard(cardData)
        setFormData({
          name: cardData.name || '',
          description: cardData.description || '',
          personality: cardData.personality || '',
          scenario: cardData.scenario || '',
          firstMes: cardData.firstMes || '',
          mesExample: cardData.mesExample || '',
          creatorNotes: cardData.creatorNotes || '',
          systemPrompt: cardData.systemPrompt || '',
          postHistoryInstructions: cardData.postHistoryInstructions || '',
          alternateGreetings: JSON.parse(cardData.alternateGreetings || '[]'),
          groupOnlyGreetings: JSON.parse(cardData.groupOnlyGreetings || '[]'),
          tags: JSON.parse(cardData.tags || '[]'),
          creator: cardData.creator || '',
          characterVersion: cardData.characterVersion || '',
          avatarPath: cardData.avatarPath || '',
          depthPromptText: cardData.depthPromptText || '',
          depthPromptDepth: cardData.depthPromptDepth ?? 4,
          depthPromptRole: (cardData.depthPromptRole as 'system' | 'user' | 'assistant') || 'system',
          linkedWorld: cardData.linkedWorld || '',
          talkativeness: cardData.talkativeness ?? 0.5,
          isFavorite: cardData.isFavorite ?? false,
          localNote: '',
          sourceUrl: cardData.sourceUrl || '',
        })

        // 加载关联的世界书
        const worldInfosData = await getWorldInfos('character', parseInt(cardId))
        setWorldInfos(worldInfosData)
      } catch (error) {
        console.error('加载角色卡失败:', error)
        toast({ title: '加载失败', variant: 'destructive' })
      } finally {
        setIsLoading(false)
      }
    }
    loadCard()
  }, [cardId, router, toast])

  // 保存角色卡
  const handleSave = async () => {
    if (!card) return

    setIsSaving(true)
    try {
      await updateCard(card.id, {
        name: formData.name,
        description: formData.description,
        personality: formData.personality,
        scenario: formData.scenario,
        firstMes: formData.firstMes,
        mesExample: formData.mesExample,
        creatorNotes: formData.creatorNotes,
        systemPrompt: formData.systemPrompt,
        postHistoryInstructions: formData.postHistoryInstructions,
        alternateGreetings: JSON.stringify(formData.alternateGreetings),
        groupOnlyGreetings: JSON.stringify(formData.groupOnlyGreetings),
        tags: JSON.stringify(formData.tags),
        creator: formData.creator,
        characterVersion: formData.characterVersion,
        avatarPath: formData.avatarPath,
        depthPromptText: formData.depthPromptText,
        depthPromptDepth: formData.depthPromptDepth,
        depthPromptRole: formData.depthPromptRole,
        linkedWorld: formData.linkedWorld,
        talkativeness: formData.talkativeness,
        isFavorite: formData.isFavorite,
        sourceUrl: formData.sourceUrl,
      })
      toast({ title: '保存成功' })
    } catch (error) {
      console.error('保存失败:', error)
      toast({ title: '保存失败', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  // 更换头像
  const handleChangeAvatar = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      })
      if (!selected) return

      const dataDir = await appDataDir()
      const avatarDir = await join(dataDir, 'tavern', 'avatars')
      if (!(await exists(avatarDir))) {
        await mkdir(avatarDir, { recursive: true })
      }

      const timestamp = Date.now()
      const ext = (selected as string).split('.').pop() || 'png'
      const newFileName = `${formData.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_${timestamp}.${ext}`
      const newPath = await join(avatarDir, newFileName)

      await copyFile(selected as string, newPath)
      setFormData(prev => ({ ...prev, avatarPath: newPath }))
      toast({ title: '头像已更换' })
    } catch (error) {
      console.error('更换头像失败:', error)
      toast({ title: '更换头像失败', variant: 'destructive' })
    }
  }

  // 添加标签
  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()],
      }))
      setNewTag('')
    }
  }

  // 删除标签
  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag),
    }))
  }

  // 添加备用开场白
  const handleAddAlternateGreeting = () => {
    setFormData(prev => ({
      ...prev,
      alternateGreetings: [...prev.alternateGreetings, ''],
    }))
  }

  // 更新备用开场白
  const handleUpdateAlternateGreeting = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      alternateGreetings: prev.alternateGreetings.map((g, i) => (i === index ? value : g)),
    }))
  }

  // 删除备用开场白
  const handleRemoveAlternateGreeting = (index: number) => {
    setFormData(prev => ({
      ...prev,
      alternateGreetings: prev.alternateGreetings.filter((_, i) => i !== index),
    }))
  }

  // 计算角色卡总 Token 数 (必须在条件返回之前调用)
  const tokenCount = useMemo(() => {
    const texts = [
      formData.description,
      formData.personality,
      formData.scenario,
      formData.firstMes,
      formData.mesExample,
      formData.systemPrompt,
      formData.postHistoryInstructions,
      formData.depthPromptText,
      formData.creatorNotes,
      ...formData.alternateGreetings,
      ...formData.groupOnlyGreetings,
    ].filter(Boolean)
    return texts.reduce((sum, text) => sum + estimateTokens(text), 0)
  }, [
    formData.description,
    formData.personality,
    formData.scenario,
    formData.firstMes,
    formData.mesExample,
    formData.systemPrompt,
    formData.postHistoryInstructions,
    formData.depthPromptText,
    formData.creatorNotes,
    formData.alternateGreetings,
    formData.groupOnlyGreetings,
  ])

  // 头像 URL (也移到条件返回之前)
  const avatarUrl = formData.avatarPath ? convertFileSrc(formData.avatarPath) : undefined

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    )
  }

  if (!card) {
    return null
  }

  return (
    <div className="flex h-full bg-background">
      {/* 左侧 - 头像预览 */}
      <div className="w-[420px] flex-shrink-0 border-r border-border flex flex-col bg-black/90 relative">
        {/* 顶部工具栏 */}
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full bg-blue-500/80 hover:bg-blue-500"
          >
            <FileText className="h-4 w-4 text-white" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full bg-gray-500/80 hover:bg-gray-500"
          >
            <Image className="h-4 w-4 text-white" />
          </Button>
        </div>

        {/* 头像图片 */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={formData.name}
              className="max-w-full max-h-full object-contain"
              style={{ transform: `scale(${imageZoom / 100})` }}
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-white/60">
              <Image className="h-24 w-24" />
              <span>暂无头像</span>
            </div>
          )}
        </div>

        {/* 底部缩放控制 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 rounded-full px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => setImageZoom(prev => Math.max(10, prev - 10))}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Slider
            value={[imageZoom]}
            onValueChange={([v]) => setImageZoom(v)}
            min={10}
            max={200}
            step={10}
            className="w-32"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => setImageZoom(prev => Math.min(200, prev + 10))}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <span className="text-white/80 text-sm min-w-[48px] text-center">{imageZoom}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/80 hover:text-white hover:bg-white/10"
            onClick={() => setImageZoom(100)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 右侧 - 编辑区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div className="flex-1">
            <div className="text-xs text-muted-foreground mb-1">角色名称</div>
            <Input
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="text-xl font-bold border-none p-0 h-auto shadow-none focus-visible:ring-0"
              placeholder="角色名称"
            />
            {/* 来源链接 */}
            <div className="flex items-center gap-2 mt-2">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              <Input
                value={formData.sourceUrl}
                onChange={e => setFormData(prev => ({ ...prev, sourceUrl: e.target.value }))}
                placeholder="https://..."
                className="h-8 text-sm flex-1 max-w-md"
              />
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8"
                onClick={() => formData.sourceUrl && window.open(formData.sourceUrl, '_blank')}
                disabled={!formData.sourceUrl}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                打开
              </Button>
            </div>
          </div>

          {/* 右上角信息和按钮 */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">TOKENS </span>
                <span className="text-orange-500 font-bold">{tokenCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">LAST MODIFIED </span>
                <span>{card ? new Date(card.updatedAt).toLocaleDateString() + ' ' + new Date(card.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleChangeAvatar}>
                <Camera className="h-4 w-4 mr-1" />
                快照
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="bg-blue-500 hover:bg-blue-600">
                <Save className="h-4 w-4 mr-1" />
                保存
              </Button>
            </div>
            {/* 帮助和关闭 */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <HelpCircle className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 资源目录 */}
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2 text-sm">
            <FolderOpen className="h-4 w-4 text-orange-500" />
            <span className="text-orange-500">资源目录</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">未设置资源目录</div>
        </div>

        {/* 创建/设置按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-border">
          <Button variant="outline" size="sm">
            <Sparkles className="h-4 w-4 mr-1" />
            创建
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-1" />
            设置
          </Button>
        </div>

        {/* 标签页 */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="flex-1 flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b border-border h-auto p-0 bg-transparent">
            <TabsTrigger
              value="basic"
              className={cn(
                'rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2',
              )}
            >
              <FileText className="h-4 w-4 mr-2" />
              基础
            </TabsTrigger>
            <TabsTrigger
              value="dialogue"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2"
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              对话
            </TabsTrigger>
            <TabsTrigger
              value="tags"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2"
            >
              <Tag className="h-4 w-4 mr-2" />
              标签
            </TabsTrigger>
            <TabsTrigger
              value="worldbook"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2"
            >
              <Globe className="h-4 w-4 mr-2" />
              世界书
            </TabsTrigger>
            <TabsTrigger
              value="manage"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2"
            >
              <FolderCog className="h-4 w-4 mr-2" />
              管理
            </TabsTrigger>
            <TabsTrigger
              value="assets"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-blue-500 data-[state=active]:text-white px-4 py-2"
            >
              <Image className="h-4 w-4 mr-2" />
              资源
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            {/* 基础标签页 */}
            <TabsContent value="basic" className="p-4 space-y-6 m-0">
              {/* 本地备注 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-blue-500">
                    <Sparkles className="h-4 w-4" />
                    本地备注 (Local Note)
                  </Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.localNote}
                  onChange={e => setFormData(prev => ({ ...prev, localNote: e.target.value }))}
                  placeholder="这是仅存储在本地的私有备注，不会写入角色卡文件..."
                  className="min-h-[120px] bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                />
              </div>

              {/* 原简介 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>原简介 (Description)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="角色描述..."
                  className="min-h-[200px]"
                />
              </div>

              {/* 性格 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>性格 (Personality)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.personality}
                  onChange={e => setFormData(prev => ({ ...prev, personality: e.target.value }))}
                  placeholder="性格特点..."
                  className="min-h-[120px]"
                />
              </div>

              {/* 场景 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>场景 (Scenario)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.scenario}
                  onChange={e => setFormData(prev => ({ ...prev, scenario: e.target.value }))}
                  placeholder="场景设定..."
                  className="min-h-[120px]"
                />
              </div>

              {/* 深度提示词 (V3) */}
              <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
                <Label className="text-sm font-medium">深度提示词 (Depth Prompt) - V3</Label>
                <div className="space-y-3">
                  <Textarea
                    value={formData.depthPromptText}
                    onChange={e => setFormData(prev => ({ ...prev, depthPromptText: e.target.value }))}
                    placeholder="深度提示词内容..."
                    className="min-h-[100px]"
                  />
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">深度</Label>
                      <Input
                        type="number"
                        value={formData.depthPromptDepth}
                        onChange={e => setFormData(prev => ({ ...prev, depthPromptDepth: parseInt(e.target.value) || 4 }))}
                        className="w-20 h-8"
                        min={0}
                        max={100}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">角色</Label>
                      <Select
                        value={formData.depthPromptRole}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, depthPromptRole: v as 'system' | 'user' | 'assistant' }))}
                      >
                        <SelectTrigger className="w-28 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">System</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="assistant">Assistant</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              {/* 健谈度 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>健谈度 (Talkativeness): {formData.talkativeness.toFixed(2)}</Label>
                </div>
                <Slider
                  value={[formData.talkativeness]}
                  onValueChange={([v]) => setFormData(prev => ({ ...prev, talkativeness: v }))}
                  min={0}
                  max={1}
                  step={0.01}
                />
              </div>

              {/* 收藏 */}
              <div className="flex items-center justify-between">
                <Label>收藏 (Favorite)</Label>
                <Switch
                  checked={formData.isFavorite}
                  onCheckedChange={(v) => setFormData(prev => ({ ...prev, isFavorite: v }))}
                />
              </div>
            </TabsContent>

            {/* 对话标签页 */}
            <TabsContent value="dialogue" className="p-4 space-y-6 m-0">
              {/* 开场白 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>开场白 (First Message)</Label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={showHtmlPreview ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setShowHtmlPreview(false)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant={showHtmlPreview ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => setShowHtmlPreview(true)}
                    >
                      HTML预览
                    </Button>
                  </div>
                </div>
                {showHtmlPreview ? (
                  <div
                    className="min-h-[200px] p-3 rounded-md border border-input bg-background prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: formData.firstMes.replace(/\n/g, '<br/>') }}
                  />
                ) : (
                  <Textarea
                    value={formData.firstMes}
                    onChange={e => setFormData(prev => ({ ...prev, firstMes: e.target.value }))}
                    placeholder="角色的开场白..."
                    className="min-h-[200px] font-mono text-sm"
                  />
                )}
              </div>

              {/* 对话示例 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>对话示例 (Mes Example)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.mesExample}
                  onChange={e => setFormData(prev => ({ ...prev, mesExample: e.target.value }))}
                  placeholder="对话示例..."
                  className="min-h-[150px] font-mono text-sm"
                />
              </div>

              {/* 备用开场白 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>备用开场白 (Alternate Greetings)</Label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => formData.alternateGreetings.length > 0 && handleRemoveAlternateGreeting(formData.alternateGreetings.length - 1)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="default" size="icon" className="h-6 w-6" onClick={handleAddAlternateGreeting}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {formData.alternateGreetings.length === 0 ? (
                  <Textarea
                    placeholder="在此输入备用开场白..."
                    className="min-h-[100px]"
                    onFocus={handleAddAlternateGreeting}
                  />
                ) : (
                  <div className="space-y-3">
                    {formData.alternateGreetings.map((greeting, index) => (
                      <div key={index} className="relative">
                        <div className="absolute -left-6 top-2 text-xs text-muted-foreground">
                          #{index + 1}
                        </div>
                        <Textarea
                          value={greeting}
                          onChange={e => handleUpdateAlternateGreeting(index, e.target.value)}
                          placeholder={`备用开场白 ${index + 1}...`}
                          className="min-h-[100px]"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 系统提示词 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>系统提示词 (System Prompt)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.systemPrompt}
                  onChange={e => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  placeholder="系统提示词..."
                  className="min-h-[120px]"
                />
              </div>

              {/* 后历史指令 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>后历史指令 (Post-History Instructions)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.postHistoryInstructions}
                  onChange={e => setFormData(prev => ({ ...prev, postHistoryInstructions: e.target.value }))}
                  placeholder="Jailbreak / 后历史指令..."
                  className="min-h-[120px]"
                />
              </div>
            </TabsContent>

            {/* 标签页 */}
            <TabsContent value="tags" className="p-4 space-y-6 m-0">
              {/* 标签列表 */}
              <div className="space-y-2">
                <Label>标签 (Tags)</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 p-0 hover:bg-transparent"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    ref={newTagInputRef}
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    placeholder="添加新标签..."
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                  />
                  <Button onClick={handleAddTag}>
                    <Plus className="h-4 w-4 mr-1" />
                    添加
                  </Button>
                </div>
              </div>

              {/* 创作者信息 */}
              <div className="space-y-2">
                <Label>创作者 (Creator)</Label>
                <Input
                  value={formData.creator}
                  onChange={e => setFormData(prev => ({ ...prev, creator: e.target.value }))}
                  placeholder="创作者名称..."
                />
              </div>

              {/* 版本 */}
              <div className="space-y-2">
                <Label>版本 (Character Version)</Label>
                <Input
                  value={formData.characterVersion}
                  onChange={e => setFormData(prev => ({ ...prev, characterVersion: e.target.value }))}
                  placeholder="1.0"
                />
              </div>

              {/* 创作者笔记 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>创作者笔记 (Creator Notes)</Label>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={formData.creatorNotes}
                  onChange={e => setFormData(prev => ({ ...prev, creatorNotes: e.target.value }))}
                  placeholder="创作者笔记..."
                  className="min-h-[150px]"
                />
              </div>
            </TabsContent>

            {/* 世界书标签页 */}
            <TabsContent value="worldbook" className="p-4 space-y-4 m-0">
              {/* 关联世界书 */}
              <div className="space-y-2">
                <Label>关联世界书 (Linked World)</Label>
                <Input
                  value={formData.linkedWorld}
                  onChange={e => setFormData(prev => ({ ...prev, linkedWorld: e.target.value }))}
                  placeholder="世界书名称..."
                />
              </div>

              {/* 内嵌世界书列表 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>内嵌世界书条目 ({worldInfos.length})</Label>
                  <Button variant="outline" size="sm" onClick={() => router.push('/core/tavern/world-info')}>
                    <Settings className="h-4 w-4 mr-1" />
                    管理世界书
                  </Button>
                </div>
                {worldInfos.length > 0 ? (
                  <div className="space-y-2">
                    {worldInfos.map(wi => (
                      <div key={wi.id} className="p-3 rounded-lg border border-border">
                        <div className="font-medium">{wi.name}</div>
                        <div className="text-sm text-muted-foreground">{wi.description}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    暂无内嵌世界书
                  </div>
                )}
              </div>
            </TabsContent>

            {/* 管理标签页 */}
            <TabsContent value="manage" className="p-4 space-y-4 m-0">
              <div className="text-center text-muted-foreground py-8">
                管理功能开发中...
              </div>
            </TabsContent>

            {/* 资源标签页 */}
            <TabsContent value="assets" className="p-4 space-y-4 m-0">
              <div className="text-center text-muted-foreground py-8">
                资源管理功能开发中...
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  )
}

// 默认导出：使用 Suspense 包装以支持 useSearchParams
export default function CharacterEditorPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="text-muted-foreground">加载中...</div></div>}>
      <CharacterEditorContent />
    </Suspense>
  )
}
