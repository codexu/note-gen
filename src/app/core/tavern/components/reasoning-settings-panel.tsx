'use client';

import { Brain, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useReasoningStore } from '@/stores/tavern-reasoning';

/**
 * 思考过程设置面板
 */
export function ReasoningSettingsPanel() {
  const { settings, updateSettings } = useReasoningStore();

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
            >
              <Brain className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>思考过程设置</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            <h4 className="font-medium">思考过程设置</h4>
          </div>

          <Separator />

          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="reasoning-enabled" className="text-sm">
              启用思考过程显示
            </Label>
            <Switch
              id="reasoning-enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) => updateSettings({ enabled: checked })}
            />
          </div>

          {/* 自动展开 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="reasoning-auto-expand" className="text-sm">
              自动展开思考过程
            </Label>
            <Switch
              id="reasoning-auto-expand"
              checked={settings.autoExpand}
              onCheckedChange={(checked) => updateSettings({ autoExpand: checked })}
            />
          </div>

          {/* 自动解析 */}
          <div className="flex items-center justify-between">
            <Label htmlFor="reasoning-auto-parse" className="text-sm">
              自动解析思考标签
            </Label>
            <Switch
              id="reasoning-auto-parse"
              checked={settings.autoParse}
              onCheckedChange={(checked) => updateSettings({ autoParse: checked })}
            />
          </div>

          <Separator />

          {/* 标签设置 */}
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">解析标签</Label>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="reasoning-prefix" className="text-xs">
                  开始标签
                </Label>
                <Input
                  id="reasoning-prefix"
                  value={settings.prefix}
                  onChange={(e) => updateSettings({ prefix: e.target.value })}
                  placeholder="<think>"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reasoning-suffix" className="text-xs">
                  结束标签
                </Label>
                <Input
                  id="reasoning-suffix"
                  value={settings.suffix}
                  onChange={(e) => updateSettings({ suffix: e.target.value })}
                  placeholder="</think>"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* 添加到提示词 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="reasoning-add-to-prompts" className="text-sm">
                添加到后续提示词
              </Label>
              <Switch
                id="reasoning-add-to-prompts"
                checked={settings.addToPrompts}
                onCheckedChange={(checked) => updateSettings({ addToPrompts: checked })}
              />
            </div>

            {settings.addToPrompts && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    最大添加数量: {settings.maxAdditions}
                  </Label>
                </div>
                <Slider
                  value={[settings.maxAdditions]}
                  onValueChange={([value]) => updateSettings({ maxAdditions: value })}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* 预设模板 */}
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">快速预设</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => updateSettings({
                  prefix: '<think>',
                  suffix: '</think>',
                })}
              >
                DeepSeek
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => updateSettings({
                  prefix: '<thinking>',
                  suffix: '</thinking>',
                })}
              >
                Claude
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => updateSettings({
                  prefix: '<reasoning>',
                  suffix: '</reasoning>',
                })}
              >
                Custom
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
