'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Wrench,
  Play,
  Trash2,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react'
import { 
  useTavernToolCallingStore, 
  BUILTIN_TOOLS,
  ToolCategory,
} from '@/stores/tavern-tool-calling'
import { executeToolCall } from '@/lib/tavern/tool-calling-service'
import { toast } from '@/hooks/use-toast'

interface ToolCallingPanelProps {
  compact?: boolean
}

const CATEGORY_NAMES: Record<ToolCategory, string> = {
  search: '搜索',
  calculate: '计算',
  datetime: '日期时间',
  random: '随机',
  text: '文本',
  custom: '自定义',
}

export function ToolCallingPanel({ compact = false }: ToolCallingPanelProps) {
  const {
    config,
    updateConfig,
    getAllTools,
    toggleBuiltinTool,
    getCallHistory,
    clearCallHistory,
  } = useTavernToolCallingStore()
  
  const [testToolName, setTestToolName] = useState('')
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  
  const allTools = getAllTools()
  const callHistory = getCallHistory(10)
  
  // 测试工具
  const handleTestTool = async () => {
    if (!testToolName) {
      toast({ title: '请选择工具', variant: 'destructive' })
      return
    }
    
    setIsTesting(true)
    try {
      const args = JSON.parse(testArgs)
      const result = await executeToolCall({
        id: `test-${Date.now()}`,
        toolName: testToolName,
        arguments: args,
        timestamp: Date.now(),
      })
      
      if (result.success) {
        setTestResult(result.result || '执行成功')
      } else {
        setTestResult(`错误: ${result.error}`)
      }
    } catch (error) {
      setTestResult(`参数解析错误: ${error}`)
    } finally {
      setIsTesting(false)
    }
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
                className={`h-8 w-8 ${config.enabled ? 'text-orange-500' : ''}`}
              >
                <Wrench className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>工具调用</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">工具调用</Label>
              <Switch
                checked={config.enabled}
                onCheckedChange={(enabled) => updateConfig({ enabled })}
              />
            </div>
            
            {config.enabled && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">自动执行</Label>
                  <Switch
                    checked={config.autoExecute}
                    onCheckedChange={(autoExecute) => updateConfig({ autoExecute })}
                  />
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs">可用工具 ({allTools.filter(t => t.isEnabled).length})</Label>
                  <ScrollArea className="h-32">
                    <div className="space-y-1">
                      {allTools.map(tool => (
                        <div
                          key={tool.id}
                          className="flex items-center justify-between p-1.5 text-xs bg-muted rounded"
                        >
                          <span>{tool.name}</span>
                          <Switch
                            checked={tool.isEnabled}
                            onCheckedChange={(enabled) => {
                              if (tool.isBuiltin) {
                                toggleBuiltinTool(tool.name, enabled)
                              }
                            }}
                            className="scale-75"
                          />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
                
                {callHistory.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">最近调用</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-xs"
                        onClick={clearCallHistory}
                      >
                        清除
                      </Button>
                    </div>
                    <ScrollArea className="h-24">
                      <div className="space-y-1">
                        {callHistory.map(call => (
                          <div
                            key={call.callId}
                            className="flex items-center gap-1 p-1 text-xs bg-muted rounded"
                          >
                            {call.success ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <XCircle className="h-3 w-3 text-red-500" />
                            )}
                            <span className="truncate">{call.toolName}</span>
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
          <Wrench className="h-5 w-5" />
          <h3 className="font-medium">工具调用</h3>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>
      
      {config.enabled && (
        <Tabs defaultValue="tools" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="tools">工具</TabsTrigger>
            <TabsTrigger value="test">测试</TabsTrigger>
            <TabsTrigger value="history">历史</TabsTrigger>
          </TabsList>
          
          <TabsContent value="tools" className="space-y-4">
            {/* 配置 */}
            <div className="space-y-3 p-3 border rounded-lg">
              <div className="flex items-center justify-between">
                <Label className="text-sm">自动执行工具调用</Label>
                <Switch
                  checked={config.autoExecute}
                  onCheckedChange={(autoExecute) => updateConfig({ autoExecute })}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-sm">显示调用过程</Label>
                <Switch
                  checked={config.showToolCalls}
                  onCheckedChange={(showToolCalls) => updateConfig({ showToolCalls })}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm">单次最大调用: {config.maxCalls}</Label>
                <Slider
                  value={[config.maxCalls]}
                  onValueChange={([v]) => updateConfig({ maxCalls: v })}
                  min={1}
                  max={10}
                  step={1}
                />
              </div>
            </div>
            
            {/* 工具列表 */}
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {Object.entries(CATEGORY_NAMES).map(([category, name]) => {
                  const categoryTools = allTools.filter(t => t.category === category)
                  if (categoryTools.length === 0) return null
                  
                  return (
                    <div key={category} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{name}</Label>
                      {categoryTools.map(tool => (
                        <div
                          key={tool.id}
                          className="flex items-center justify-between p-2 border rounded"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">{tool.name}</span>
                              {tool.isBuiltin && (
                                <Badge variant="secondary" className="text-xs">内置</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {tool.description}
                            </p>
                          </div>
                          <Switch
                            checked={tool.isEnabled}
                            onCheckedChange={(enabled) => {
                              if (tool.isBuiltin) {
                                toggleBuiltinTool(tool.name, enabled)
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="test" className="space-y-4">
            <div className="space-y-2">
              <Label>选择工具</Label>
              <select
                value={testToolName}
                onChange={(e) => setTestToolName(e.target.value)}
                className="w-full p-2 border rounded text-sm"
              >
                <option value="">选择工具...</option>
                {allTools.filter(t => t.isEnabled).map(tool => (
                  <option key={tool.id} value={tool.name}>
                    {tool.name} - {tool.description}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>参数 (JSON)</Label>
              <Textarea
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
                placeholder='{"param": "value"}'
                rows={3}
                className="font-mono text-sm"
              />
            </div>
            
            <Button
              onClick={handleTestTool}
              disabled={isTesting || !testToolName}
              className="w-full"
            >
              {isTesting ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  执行中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  执行工具
                </>
              )}
            </Button>
            
            {testResult && (
              <div className="space-y-2">
                <Label>执行结果</Label>
                <div className="p-3 bg-muted rounded-lg">
                  <pre className="text-sm whitespace-pre-wrap">{testResult}</pre>
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="history" className="space-y-4">
            {callHistory.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                暂无调用历史
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    最近 {callHistory.length} 次调用
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearCallHistory}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    清除历史
                  </Button>
                </div>
                
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {callHistory.map(call => (
                      <div
                        key={call.callId}
                        className="p-3 border rounded-lg space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {call.success ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="font-mono text-sm">{call.toolName}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(call.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {call.success ? call.result : call.error}
                        </div>
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
