'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Braces,
  Variable,
  Plus,
  Trash2,
  Copy,
  Edit,
  Check,
} from 'lucide-react'
import { useTavernMacrosStore, MacroCategory, BUILTIN_MACROS } from '@/stores/tavern-macros'
import { useTavernVariablesStore } from '@/stores/tavern-variables'
import { toast } from '@/hooks/use-toast'

interface MacrosVariablesPanelProps {
  chatId?: number
  compact?: boolean
}

export function MacrosVariablesPanel({ chatId, compact = false }: MacrosVariablesPanelProps) {
  const macrosStore = useTavernMacrosStore()
  const variablesStore = useTavernVariablesStore()
  
  const [newMacroName, setNewMacroName] = useState('')
  const [newMacroValue, setNewMacroValue] = useState('')
  const [newMacroCategory, setNewMacroCategory] = useState<MacroCategory>('custom')
  
  const [newVarName, setNewVarName] = useState('')
  const [newVarValue, setNewVarValue] = useState('')
  const [newVarScope, setNewVarScope] = useState<'global' | 'chat'>('chat')
  
  const [testInput, setTestInput] = useState('')
  const [testOutput, setTestOutput] = useState('')
  
  // 添加自定义宏
  const handleAddMacro = () => {
    if (!newMacroName.trim()) {
      toast({ title: '请输入宏名称', variant: 'destructive' })
      return
    }
    macrosStore.addCustomMacro({
      name: newMacroName.trim(),
      value: newMacroValue,
      description: '',
      category: newMacroCategory,
      isEnabled: true,
    })
    setNewMacroName('')
    setNewMacroValue('')
    toast({ title: '宏已添加' })
  }
  
  // 添加变量
  const handleAddVariable = () => {
    if (!newVarName.trim()) {
      toast({ title: '请输入变量名', variant: 'destructive' })
      return
    }
    if (newVarScope === 'global') {
      variablesStore.setGlobalVariable(newVarName.trim(), newVarValue)
    } else if (chatId !== undefined) {
      variablesStore.setChatVariable(chatId, newVarName.trim(), newVarValue)
    }
    setNewVarName('')
    setNewVarValue('')
    toast({ title: '变量已添加' })
  }
  
  // 测试宏解析
  const handleTestMacro = () => {
    const result = macrosStore.resolveMacros(testInput, {
      characterName: '角色名',
      userName: '用户名',
      variables: variablesStore.getAllVariables(chatId),
    })
    setTestOutput(result)
  }
  
  // 复制宏到剪贴板
  const copyMacro = (name: string) => {
    navigator.clipboard.writeText(`{{${name}}}`)
    toast({ title: '已复制到剪贴板' })
  }
  
  const allMacros = macrosStore.getAllMacros()
  const globalVars = variablesStore.listGlobalVariables()
  const chatVars = chatId !== undefined ? variablesStore.listChatVariables(chatId) : []
  
  if (compact) {
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Braces className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>宏与变量</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent className="w-80" align="end">
          <Tabs defaultValue="macros" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="macros" className="text-xs">宏</TabsTrigger>
              <TabsTrigger value="variables" className="text-xs">变量</TabsTrigger>
            </TabsList>
            
            <TabsContent value="macros" className="space-y-2">
              <ScrollArea className="h-48">
                <div className="space-y-1">
                  {allMacros.filter(m => m.isEnabled).slice(0, 20).map(macro => (
                    <div
                      key={macro.id}
                      className="flex items-center justify-between p-1.5 text-xs bg-muted rounded cursor-pointer hover:bg-muted/80"
                      onClick={() => copyMacro(macro.name)}
                    >
                      <span className="font-mono">{`{{${macro.name}}}`}</span>
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="variables" className="space-y-2">
              <div className="flex gap-1">
                <Input
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  placeholder="变量名"
                  className="h-7 text-xs"
                />
                <Input
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  placeholder="值"
                  className="h-7 text-xs"
                />
                <Button size="sm" className="h-7 px-2" onClick={handleAddVariable}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <ScrollArea className="h-40">
                <div className="space-y-1">
                  {[...globalVars, ...chatVars].map(v => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-1.5 text-xs bg-muted rounded"
                    >
                      <span>
                        <Badge variant="outline" className="text-[10px] mr-1">
                          {v.scope === 'global' ? 'G' : 'C'}
                        </Badge>
                        {v.name}
                      </span>
                      <span className="text-muted-foreground truncate max-w-20">{v.value}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    )
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Braces className="h-5 w-5" />
        <h3 className="font-medium">宏与变量</h3>
      </div>
      
      <Tabs defaultValue="macros" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="macros">宏</TabsTrigger>
          <TabsTrigger value="variables">变量</TabsTrigger>
          <TabsTrigger value="test">测试</TabsTrigger>
        </TabsList>
        
        <TabsContent value="macros" className="space-y-4">
          {/* 添加自定义宏 */}
          <div className="space-y-2 p-3 border rounded-lg">
            <Label className="text-sm">添加自定义宏</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={newMacroName}
                onChange={(e) => setNewMacroName(e.target.value)}
                placeholder="宏名称"
              />
              <Select
                value={newMacroCategory}
                onValueChange={(v) => setNewMacroCategory(v as MacroCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">自定义</SelectItem>
                  <SelectItem value="character">角色</SelectItem>
                  <SelectItem value="user">用户</SelectItem>
                  <SelectItem value="chat">聊天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={newMacroValue}
              onChange={(e) => setNewMacroValue(e.target.value)}
              placeholder="宏值 (可包含其他宏)"
              rows={2}
            />
            <Button onClick={handleAddMacro} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              添加宏
            </Button>
          </div>
          
          {/* 宏列表 */}
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {allMacros.map(macro => (
                <div
                  key={macro.id}
                  className="flex items-center justify-between p-2 border rounded"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-muted px-1 rounded">
                        {`{{${macro.name}}}`}
                      </code>
                      <Badge variant="outline" className="text-xs">
                        {macro.category}
                      </Badge>
                      {macro.isBuiltin && (
                        <Badge variant="secondary" className="text-xs">内置</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {macro.description || macro.value}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyMacro(macro.name)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    {!macro.isBuiltin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => macrosStore.deleteCustomMacro(macro.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="variables" className="space-y-4">
          {/* 添加变量 */}
          <div className="space-y-2 p-3 border rounded-lg">
            <Label className="text-sm">添加变量</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={newVarName}
                onChange={(e) => setNewVarName(e.target.value)}
                placeholder="变量名"
              />
              <Input
                value={newVarValue}
                onChange={(e) => setNewVarValue(e.target.value)}
                placeholder="值"
              />
              <Select
                value={newVarScope}
                onValueChange={(v) => setNewVarScope(v as 'global' | 'chat')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="chat">聊天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddVariable} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              添加变量
            </Button>
          </div>
          
          {/* 变量列表 */}
          <div className="space-y-3">
            {globalVars.length > 0 && (
              <div>
                <Label className="text-sm text-muted-foreground">全局变量</Label>
                <div className="space-y-1 mt-1">
                  {globalVars.map(v => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                    >
                      <span className="font-mono text-sm">{v.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{v.value}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => variablesStore.deleteGlobalVariable(v.name)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {chatVars.length > 0 && (
              <div>
                <Label className="text-sm text-muted-foreground">聊天变量</Label>
                <div className="space-y-1 mt-1">
                  {chatVars.map(v => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                    >
                      <span className="font-mono text-sm">{v.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{v.value}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => chatId !== undefined && variablesStore.deleteChatVariable(chatId, v.name)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {globalVars.length === 0 && chatVars.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                暂无变量
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="test" className="space-y-4">
          <div className="space-y-2">
            <Label>测试宏解析</Label>
            <Textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="输入包含宏的文本，如: 你好 {{user}}，我是 {{char}}"
              rows={3}
            />
            <Button onClick={handleTestMacro} className="w-full">
              解析
            </Button>
          </div>
          
          {testOutput && (
            <div className="space-y-2">
              <Label>解析结果</Label>
              <div className="p-3 bg-muted rounded-lg">
                <pre className="text-sm whitespace-pre-wrap">{testOutput}</pre>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
