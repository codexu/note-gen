'use client';

import { useState, useRef } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  Check,
  Lock,
  Unlock,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  useBackgroundsStore,
  type BackgroundConfig,
  type BackgroundFitting,
} from '@/stores/tavern-backgrounds';

interface BackgroundsPanelProps {
  chatId?: string;
}

/**
 * 背景缩略图组件
 */
function BackgroundThumbnail({
  background,
  isSelected,
  isLocked,
  onSelect,
  onDelete,
}: {
  background: BackgroundConfig;
  isSelected: boolean;
  isLocked?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all',
        isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-muted-foreground/30'
      )}
      onClick={onSelect}
    >
      {background.url ? (
        <img
          src={background.url}
          alt={background.name}
          className="w-full h-20 object-cover"
        />
      ) : (
        <div className="w-full h-20 bg-muted flex items-center justify-center">
          <span className="text-xs text-muted-foreground">无背景</span>
        </div>
      )}
      
      {/* 选中标记 */}
      {isSelected && (
        <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
          <Check className="h-3 w-3" />
        </div>
      )}
      
      {/* 锁定标记 */}
      {isLocked && (
        <div className="absolute top-1 left-1 bg-yellow-500 text-white rounded-full p-0.5">
          <Lock className="h-3 w-3" />
        </div>
      )}
      
      {/* 删除按钮 */}
      {background.isCustom && onDelete && (
        <Button
          size="icon"
          variant="destructive"
          className="absolute bottom-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
      
      {/* 名称 */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
        <span className="text-xs text-white truncate block">{background.name}</span>
      </div>
    </div>
  );
}

/**
 * 背景设置面板
 */
export function BackgroundsPanel({ chatId }: BackgroundsPanelProps) {
  const {
    enabled,
    setEnabled,
    backgrounds,
    globalBackgroundId,
    globalFitting,
    globalOpacity,
    globalBlur,
    globalBrightness,
    setGlobalBackground,
    setGlobalSettings,
    addBackground,
    removeBackground,
    chatBackgrounds,
    setChatBackground,
    clearChatBackground,
  } = useBackgroundsStore();

  const [activeTab, setActiveTab] = useState<'global' | 'chat'>('global');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chatBackgroundId = chatId ? chatBackgrounds[chatId] : null;
  const currentBackgroundId = activeTab === 'chat' && chatId ? chatBackgroundId : globalBackgroundId;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      const name = file.name.replace(/\.[^/.]+$/, '');
      addBackground({
        name,
        url,
        isCustom: true,
        fitting: 'cover',
        opacity: 100,
        blur: 0,
        brightness: 100,
      });
    };
    reader.readAsDataURL(file);
    
    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSelectBackground = (backgroundId: string | null) => {
    if (activeTab === 'chat' && chatId) {
      setChatBackground(chatId, backgroundId);
    } else {
      setGlobalBackground(backgroundId);
    }
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ImageIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>聊天背景</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              <h4 className="font-medium">聊天背景</h4>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'global' | 'chat')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="global">全局背景</TabsTrigger>
                  <TabsTrigger value="chat" disabled={!chatId}>
                    聊天背景
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="global" className="space-y-3">
                  <ScrollArea className="h-40">
                    <div className="grid grid-cols-3 gap-2 p-1">
                      {backgrounds.map((bg) => (
                        <BackgroundThumbnail
                          key={bg.id}
                          background={bg}
                          isSelected={globalBackgroundId === bg.id}
                          onSelect={() => handleSelectBackground(bg.id)}
                          onDelete={bg.isCustom ? () => removeBackground(bg.id) : undefined}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="chat" className="space-y-3">
                  {chatId ? (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {chatBackgroundId ? '使用专属背景' : '使用全局背景'}
                        </span>
                        {chatBackgroundId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => clearChatBackground(chatId)}
                          >
                            <Unlock className="h-3 w-3 mr-1" />
                            解锁
                          </Button>
                        )}
                      </div>
                      <ScrollArea className="h-40">
                        <div className="grid grid-cols-3 gap-2 p-1">
                          {backgrounds.map((bg) => (
                            <BackgroundThumbnail
                              key={bg.id}
                              background={bg}
                              isSelected={chatBackgroundId === bg.id}
                              isLocked={chatBackgroundId === bg.id}
                              onSelect={() => handleSelectBackground(bg.id)}
                              onDelete={bg.isCustom ? () => removeBackground(bg.id) : undefined}
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <div className="text-center text-sm text-muted-foreground py-4">
                      请先选择一个聊天
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <Separator />

              {/* 上传按钮 */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  上传背景图片
                </Button>
              </div>

              <Separator />

              {/* 显示设置 */}
              <div className="space-y-3">
                <Label className="text-sm text-muted-foreground">显示设置</Label>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">适配模式</Label>
                    <Select
                      value={globalFitting}
                      onValueChange={(v) => setGlobalSettings({ fitting: v as BackgroundFitting })}
                    >
                      <SelectTrigger className="w-24 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cover">填充</SelectItem>
                        <SelectItem value="contain">适应</SelectItem>
                        <SelectItem value="stretch">拉伸</SelectItem>
                        <SelectItem value="center">居中</SelectItem>
                        <SelectItem value="tile">平铺</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">透明度</Label>
                      <span className="text-xs text-muted-foreground">{globalOpacity}%</span>
                    </div>
                    <Slider
                      value={[globalOpacity]}
                      onValueChange={([v]) => setGlobalSettings({ opacity: v })}
                      min={0}
                      max={100}
                      step={5}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">模糊</Label>
                      <span className="text-xs text-muted-foreground">{globalBlur}px</span>
                    </div>
                    <Slider
                      value={[globalBlur]}
                      onValueChange={([v]) => setGlobalSettings({ blur: v })}
                      min={0}
                      max={20}
                      step={1}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">亮度</Label>
                      <span className="text-xs text-muted-foreground">{globalBrightness}%</span>
                    </div>
                    <Slider
                      value={[globalBrightness]}
                      onValueChange={([v]) => setGlobalSettings({ brightness: v })}
                      min={0}
                      max={200}
                      step={5}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
