'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Database,
  Search,
  Settings,
  FileText,
  Globe,
  MessageSquare,
  File,
  Loader2,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Trash2,
  HardDrive,
} from 'lucide-react'
import { useTavernVectorsStore, VectorSource } from '@/stores/tavern-vectors'
import { 
  performVectorSearch, 
  checkVectorsAvailable 
} from '@/lib/tavern/vectors-service'
import {
  indexWorldInfo,
  getVectorizeProgress as getWIVectorizeProgress,
  clearWorldInfoCache,
} from '@/lib/tavern/wi-vectors'
import {
  indexChat,
  getVectorizeProgress as getChatVectorizeProgress,
  clearChatCache,
} from '@/lib/tavern/chat-vectors'
import { useEffect } from 'react'
import { toast } from '@/hooks/use-toast'

// 来源配置
const SOURCE_OPTIONS: { value: VectorSource; label: string; icon: React.ReactNode }[] = [
  { value: 'notes', label: '笔记', icon: <FileText className="h-4 w-4" /> },
  { value: 'worldInfo', label: 'World Info', icon: <Globe className="h-4 w-4" /> },
  { value: 'chatHistory', label: '聊天历史', icon: <MessageSquare className="h-4 w-4" /> },
  { value: 'custom', label: '自定义文档', icon: <File className="h-4 w-4" /> },
]

interface VectorsPanelProps {
  compact?: boolean
  /** 当前世界书 ID (用于索引管理) */
  worldInfoId?: number
  /** 当前聊天 ID (用于索引管理) */
  chatId?: number
}

export function VectorsPanel({ compact = false, worldInfoId, chatId }: VectorsPanelProps) {
  const {
    config,
    currentResults,
    isSearching,
    lastQuery,
    updateConfig,
    clearSearchResults,
  } = useTavernVectorsStore()

  const [testQuery, setTestQuery] = useState('')
  const [availability, setAvailability] = useState<{
    checked: boolean
    available: boolean
    reason?: string
  }>({ checked: false, available: false })
  
  // 索引管理状态
  const [wiIndexState, setWIIndexState] = useState<{
    progress: { total: number; vectorized: number; percentage: number } | null
    isIndexing: boolean
    lastError?: string
  }>({ progress: null, isIndexing: false })
  
  const [chatIndexState, setChatIndexState] = useState<{
    progress: { total: number; vectorized: number; percentage: number } | null
    isIndexing: boolean
    lastError?: string
  }>({ progress: null, isIndexing: false })

  // 检查可用性
  useEffect(() => {
    if (config.enabled && !availability.checked) {
      checkVectorsAvailable().then(result => {
        setAvailability({
          checked: true,
          available: result.available,
          reason: result.reason,
        })
      })
    }
  }, [config.enabled, availability.checked])

  // 加载索引状态
  useEffect(() => {
    if (worldInfoId) {
      getWIVectorizeProgress(worldInfoId).then(progress => {
        setWIIndexState(prev => ({ ...prev, progress }))
      })
    }
  }, [worldInfoId])
  
  useEffect(() => {
    if (chatId) {
      getChatVectorizeProgress(chatId).then(progress => {
        setChatIndexState(prev => ({ ...prev, progress }))
      })
    }
  }, [chatId])

  // 执行测试搜索
  const handleTestSearch = async () => {
    if (!testQuery.trim()) return
    await performVectorSearch(testQuery)
  }
  
  // 索引 World Info
  const handleIndexWorldInfo = useCallback(async () => {
    if (!worldInfoId) return
    
    setWIIndexState(prev => ({ ...prev, isIndexing: true, lastError: undefined }))
    try {
      await indexWorldInfo(worldInfoId, (current, total) => {
        setWIIndexState(prev => ({
          ...prev,
          progress: { total, vectorized: current, percentage: Math.round(current / total * 100) }
        }))
      })
      toast({ title: 'World Info 索引完成' })
    } catch (error) {
      const msg = error instanceof Error ? error.message : '索引失败'
      setWIIndexState(prev => ({ ...prev, lastError: msg }))
      toast({ title: '索引失败', description: msg, variant: 'destructive' })
    } finally {
      setWIIndexState(prev => ({ ...prev, isIndexing: false }))
    }
  }, [worldInfoId])
  
  // 索引聊天历史
  const handleIndexChat = useCallback(async () => {
    if (!chatId) return
    
    setChatIndexState(prev => ({ ...prev, isIndexing: true, lastError: undefined }))
    try {
      await indexChat(chatId, (current, total) => {
        setChatIndexState(prev => ({
          ...prev,
          progress: { total, vectorized: current, percentage: Math.round(current / total * 100) }
        }))
      })
      toast({ title: '聊天历史索引完成' })
    } catch (error) {
      const msg = error instanceof Error ? error.message : '索引失败'
      setChatIndexState(prev => ({ ...prev, lastError: msg }))
      toast({ title: '索引失败', description: msg, variant: 'destructive' })
    } finally {
      setChatIndexState(prev => ({ ...prev, isIndexing: false }))
    }
  }, [chatId])
  
  // 清除 World Info 索引
  const handleClearWIIndex = useCallback(() => {
    if (!worldInfoId) return
    clearWorldInfoCache(worldInfoId)
    setWIIndexState({ progress: { total: 0, vectorized: 0, percentage: 0 }, isIndexing: false })
    toast({ title: 'World Info 索引已清除' })
  }, [worldInfoId])
  
  // 清除聊天索引
  const handleClearChatIndex = useCallback(() => {
    if (!chatId) return
    clearChatCache(chatId)
    setChatIndexState({ progress: { total: 0, vectorized: 0, percentage: 0 }, isIndexing: false })
    toast({ title: '聊天索引已清除' })
  }, [chatId])

  // 切换来源
  const toggleSource = (source: VectorSource) => {
    const newSources = config.sources.includes(source)
      ? config.sources.filter(s => s !== source)
      : [...config.sources, source]
    updateConfig({ sources: newSources })
  }

  if (compact) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${config.enabled ? 'text-purple-500' : ''}`}
              >
                <Database className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>向量检索 (RAG)</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">向量检索</Label>
              <Switch
                checked={config.enabled}
                onCheckedChange={(enabled) => updateConfig({ enabled })}
              />
            </div>

            {config.enabled && (
              <>
                {!availability.available && availability.checked && (
                  <div className="flex items-center gap-2 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{availability.reason}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs">搜索来源</Label>
                  <div className="flex flex-wrap gap-1">
                    {SOURCE_OPTIONS.map(option => (
                      <Badge
                        key={option.value}
                        variant={config.sources.includes(option.value) ? 'default' : 'outline'}
                        className="cursor-pointer text-xs"
                        onClick={() => toggleSource(option.value)}
                      >
                        {option.icon}
                        <span className="ml-1">{option.label}</span>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">最大结果数: {config.maxResults}</Label>
                  <Slider
                    value={[config.maxResults]}
                    onValueChange={([v]) => updateConfig({ maxResults: v })}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">相似度阈值: {config.similarityThreshold.toFixed(2)}</Label>
                  <Slider
                    value={[config.similarityThreshold]}
                    onValueChange={([v]) => updateConfig({ similarityThreshold: v })}
                    min={0.1}
                    max={1}
                    step={0.05}
                  />
                </div>

                {currentResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">搜索结果 ({currentResults.length})</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={clearSearchResults}
                      >
                        清除
                      </Button>
                    </div>
                    <ScrollArea className="h-32">
                      <div className="space-y-1">
                        {currentResults.map(result => (
                          <div
                            key={result.id}
                            className="text-xs p-2 bg-muted rounded"
                          >
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Badge variant="outline" className="text-[10px]">
                                {result.source}
                              </Badge>
                              <span className="truncate">{result.filename}</span>
                            </div>
                            <p className="mt-1 line-clamp-2">{result.content}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <h3 className="font-medium">向量检索 (RAG)</h3>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>

      {config.enabled && (
        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="settings">设置</TabsTrigger>
            <TabsTrigger value="index">索引</TabsTrigger>
            <TabsTrigger value="search">搜索</TabsTrigger>
            <TabsTrigger value="results">结果</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-4">
            {/* 可用性状态 */}
            {availability.checked && (
              <div className={`flex items-center gap-2 text-sm p-2 rounded ${
                availability.available 
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600' 
                  : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600'
              }`}>
                {availability.available ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                <span>
                  {availability.available ? '向量功能可用' : availability.reason}
                </span>
              </div>
            )}

            {/* 搜索来源 */}
            <div className="space-y-2">
              <Label>搜索来源</Label>
              <div className="grid grid-cols-2 gap-2">
                {SOURCE_OPTIONS.map(option => (
                  <div
                    key={option.value}
                    className="flex items-center space-x-2"
                  >
                    <Checkbox
                      id={`source-${option.value}`}
                      checked={config.sources.includes(option.value)}
                      onCheckedChange={() => toggleSource(option.value)}
                    />
                    <Label
                      htmlFor={`source-${option.value}`}
                      className="flex items-center gap-1 text-sm cursor-pointer"
                    >
                      {option.icon}
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* 搜索参数 */}
            <div className="space-y-2">
              <Label>最大结果数: {config.maxResults}</Label>
              <Slider
                value={[config.maxResults]}
                onValueChange={([v]) => updateConfig({ maxResults: v })}
                min={1}
                max={20}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label>相似度阈值: {config.similarityThreshold.toFixed(2)}</Label>
              <Slider
                value={[config.similarityThreshold]}
                onValueChange={([v]) => updateConfig({ similarityThreshold: v })}
                min={0.1}
                max={1}
                step={0.05}
              />
            </div>

            {/* 自动搜索设置 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>自动搜索</Label>
                <Switch
                  checked={config.autoSearch}
                  onCheckedChange={(autoSearch) => updateConfig({ autoSearch })}
                />
              </div>
              {config.autoSearch && (
                <Select
                  value={config.autoSearchTrigger}
                  onValueChange={(v) => updateConfig({ autoSearchTrigger: v as typeof config.autoSearchTrigger })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">每条消息</SelectItem>
                    <SelectItem value="keywords">检测到关键词时</SelectItem>
                    <SelectItem value="manual">仅手动触发</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 注入位置 */}
            <div className="space-y-2">
              <Label>上下文注入位置</Label>
              <Select
                value={config.injectPosition}
                onValueChange={(v) => updateConfig({ injectPosition: v as typeof config.injectPosition })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before_scenario">场景描述前</SelectItem>
                  <SelectItem value="after_scenario">场景描述后</SelectItem>
                  <SelectItem value="in_chat">聊天消息中</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.injectPosition === 'in_chat' && (
              <div className="space-y-2">
                <Label>注入深度: {config.injectDepth}</Label>
                <Slider
                  value={[config.injectDepth]}
                  onValueChange={([v]) => updateConfig({ injectDepth: v })}
                  min={0}
                  max={20}
                  step={1}
                />
              </div>
            )}

            {/* 上下文模板 */}
            <div className="space-y-2">
              <Label>上下文模板</Label>
              <Textarea
                value={config.contextTemplate}
                onChange={(e) => updateConfig({ contextTemplate: e.target.value })}
                rows={6}
                className="font-mono text-xs"
                placeholder="使用 {{#each results}}...{{/each}} 遍历结果"
              />
            </div>
          </TabsContent>

          {/* 索引管理 */}
          <TabsContent value="index" className="space-y-4">
            {/* World Info 索引 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  World Info 索引
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {worldInfoId ? (
                  <>
                    {/* 状态 */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">已索引:</span>
                      <span>
                        {wiIndexState.progress?.vectorized || 0} / {wiIndexState.progress?.total || 0} 条目
                      </span>
                    </div>
                    
                    {/* 进度条 */}
                    {(wiIndexState.isIndexing || (wiIndexState.progress?.percentage || 0) > 0) && (
                      <Progress value={wiIndexState.progress?.percentage || 0} />
                    )}
                    
                    {/* 按钮 */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleIndexWorldInfo}
                        disabled={wiIndexState.isIndexing}
                        className="flex-1"
                      >
                        {wiIndexState.isIndexing ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1" />
                        )}
                        {
                          wiIndexState.isIndexing ? '索引中...' :
                          (wiIndexState.progress?.vectorized || 0) > 0 ? '重建索引' : '建立索引'
                        }
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleClearWIIndex}
                            disabled={wiIndexState.isIndexing || (wiIndexState.progress?.vectorized || 0) === 0}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>清除索引</TooltipContent>
                      </Tooltip>
                    </div>
                    
                    {wiIndexState.lastError && (
                      <div className="text-xs text-destructive">
                        {wiIndexState.lastError}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-2">
                    需要选择世界书才能管理索引
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* 聊天历史索引 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  聊天历史索引
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {chatId ? (
                  <>
                    {/* 状态 */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">已索引:</span>
                      <span>
                        {chatIndexState.progress?.vectorized || 0} / {chatIndexState.progress?.total || 0} 条消息
                      </span>
                    </div>
                    
                    {/* 进度条 */}
                    {(chatIndexState.isIndexing || (chatIndexState.progress?.percentage || 0) > 0) && (
                      <Progress value={chatIndexState.progress?.percentage || 0} />
                    )}
                    
                    {/* 按钮 */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleIndexChat}
                        disabled={chatIndexState.isIndexing}
                        className="flex-1"
                      >
                        {chatIndexState.isIndexing ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1" />
                        )}
                        {
                          chatIndexState.isIndexing ? '索引中...' :
                          (chatIndexState.progress?.vectorized || 0) > 0 ? '重建索引' : '建立索引'
                        }
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleClearChatIndex}
                            disabled={chatIndexState.isIndexing || (chatIndexState.progress?.vectorized || 0) === 0}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>清除索引</TooltipContent>
                      </Tooltip>
                    </div>
                    
                    {chatIndexState.lastError && (
                      <div className="text-xs text-destructive">
                        {chatIndexState.lastError}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-2">
                    需要打开聊天才能管理索引
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* 索引说明 */}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>• 索引后可进行语义搜索，找到相关内容</p>
              <p>• 索引需要嵌入模型支持 (RAG)</p>
              <p>• 重建索引会清除旧数据并重新生成向量</p>
            </div>
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            <div className="space-y-2">
              <Label>测试搜索</Label>
              <div className="flex gap-2">
                <Input
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="输入搜索内容..."
                  onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                />
                <Button
                  onClick={handleTestSearch}
                  disabled={isSearching || !testQuery.trim()}
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {lastQuery && (
              <div className="text-sm text-muted-foreground">
                上次搜索: {lastQuery}
              </div>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            {currentResults.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                暂无搜索结果
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    找到 {currentResults.length} 条结果
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSearchResults}
                  >
                    清除结果
                  </Button>
                </div>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {currentResults.map(result => (
                      <div
                        key={result.id}
                        className="p-3 border rounded-lg space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{result.source}</Badge>
                            <span className="text-sm font-medium truncate">
                              {result.filename}
                            </span>
                          </div>
                          <Badge variant="secondary">
                            {(result.score * 100).toFixed(0)}%
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-4">
                          {result.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
