'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Settings2, RotateCcw, Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTavernWorldInfoStore } from '@/stores/tavern-world-info'
import { DEFAULT_SCAN_CONFIG } from '@/lib/tavern/world-info-scanner'

interface WorldInfoSettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorldInfoSettingsPanel({ open, onOpenChange }: WorldInfoSettingsPanelProps) {
  const { scanConfig, updateScanConfig, resetScanConfig, save } = useTavernWorldInfoStore()
  const [localConfig, setLocalConfig] = useState(scanConfig)

  useEffect(() => {
    setLocalConfig(scanConfig)
  }, [scanConfig])

  const handleSave = async () => {
    updateScanConfig(localConfig)
    await save()
    onOpenChange(false)
  }

  const handleReset = () => {
    setLocalConfig({ ...DEFAULT_SCAN_CONFIG })
  }

  const InfoTooltip = ({ content }: { content: string }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[250px]">
          <p className="text-xs">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[450px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            世界书扫描设置
          </SheetTitle>
          <SheetDescription>
            配置世界书条目的扫描和激活行为
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <Accordion type="multiple" defaultValue={['basic', 'recursive', 'advanced']} className="w-full">
            {/* 基础设置 */}
            <AccordionItem value="basic">
              <AccordionTrigger>基础设置</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                {/* 扫描深度 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>扫描深度</Label>
                    <InfoTooltip content="检查最近多少条消息来触发世界书条目" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[localConfig.scanDepth]}
                      onValueChange={([v]) => setLocalConfig({ ...localConfig, scanDepth: v })}
                      min={1}
                      max={50}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={localConfig.scanDepth}
                      onChange={(e) => setLocalConfig({ ...localConfig, scanDepth: parseInt(e.target.value) || 1 })}
                      className="w-16 h-8"
                      min={1}
                      max={50}
                    />
                  </div>
                </div>

                {/* 大小写敏感 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label>大小写敏感</Label>
                    <InfoTooltip content="关键词匹配时是否区分大小写" />
                  </div>
                  <Switch
                    checked={localConfig.caseSensitive}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, caseSensitive: v })}
                  />
                </div>

                {/* 全词匹配 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label>全词匹配</Label>
                    <InfoTooltip content="关键词必须作为完整单词匹配，而非部分匹配" />
                  </div>
                  <Switch
                    checked={localConfig.matchWholeWords}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, matchWholeWords: v })}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* 递归扫描 */}
            <AccordionItem value="recursive">
              <AccordionTrigger>递归扫描</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                {/* 启用递归 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label>启用递归扫描</Label>
                    <InfoTooltip content="激活的条目内容会被加入扫描文本，可能触发更多条目" />
                  </div>
                  <Switch
                    checked={localConfig.recursive}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, recursive: v })}
                  />
                </div>

                {/* 最大递归步数 */}
                {localConfig.recursive && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>最大递归步数</Label>
                      <InfoTooltip content="递归扫描的最大迭代次数，防止无限循环" />
                    </div>
                    <div className="flex items-center gap-3">
                      <Slider
                        value={[localConfig.maxRecursionSteps]}
                        onValueChange={([v]) => setLocalConfig({ ...localConfig, maxRecursionSteps: v })}
                        min={1}
                        max={10}
                        step={1}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={localConfig.maxRecursionSteps}
                        onChange={(e) => setLocalConfig({ ...localConfig, maxRecursionSteps: parseInt(e.target.value) || 1 })}
                        className="w-16 h-8"
                        min={1}
                        max={10}
                      />
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* 高级设置 */}
            <AccordionItem value="advanced">
              <AccordionTrigger>高级设置</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                {/* 最小激活数 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>最小激活数</Label>
                    <InfoTooltip content="每次生成至少激活的条目数量，会扩大扫描范围直到满足" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[localConfig.minActivations]}
                      onValueChange={([v]) => setLocalConfig({ ...localConfig, minActivations: v })}
                      min={0}
                      max={20}
                      step={1}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={localConfig.minActivations}
                      onChange={(e) => setLocalConfig({ ...localConfig, minActivations: parseInt(e.target.value) || 0 })}
                      className="w-16 h-8"
                      min={0}
                      max={20}
                    />
                  </div>
                </div>

                {/* 分组评分 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label>分组评分</Label>
                    <InfoTooltip content="同一分组内只激活权重最高的条目" />
                  </div>
                  <Switch
                    checked={localConfig.useGroupScoring}
                    onCheckedChange={(v) => setLocalConfig({ ...localConfig, useGroupScoring: v })}
                  />
                </div>

                {/* Token 预算 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Token 预算</Label>
                    <InfoTooltip content="世界书内容的最大 Token 数量" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[localConfig.budgetTokens]}
                      onValueChange={([v]) => setLocalConfig({ ...localConfig, budgetTokens: v })}
                      min={256}
                      max={8192}
                      step={256}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={localConfig.budgetTokens}
                      onChange={(e) => setLocalConfig({ ...localConfig, budgetTokens: parseInt(e.target.value) || 2048 })}
                      className="w-20 h-8"
                      min={256}
                      max={8192}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleReset} className="flex-1">
              <RotateCcw className="h-4 w-4 mr-2" />
              重置默认
            </Button>
            <Button onClick={handleSave} className="flex-1">
              保存设置
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
