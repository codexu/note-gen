'use client';

import { useMemo } from 'react';
import {
  BarChart3,
  MessageSquare,
  Clock,
  Type,
  RefreshCw,
  User,
  Bot,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { useStatsStore, type CharacterStats } from '@/stores/tavern-stats';

interface StatsPanelProps {
  characterId?: string;
  characterName?: string;
}

/**
 * 格式化时长
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes}分钟`;
}

/**
 * 格式化日期
 */
function formatDate(timestamp: number): string {
  if (!timestamp) return '从未';
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

/**
 * 统计项组件
 */
function StatItem({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-sm font-medium">{value}</span>
        {subValue && (
          <span className="text-xs text-muted-foreground ml-1">({subValue})</span>
        )}
      </div>
    </div>
  );
}

/**
 * 统计面板
 */
export function StatsPanel({ characterId, characterName }: StatsPanelProps) {
  const {
    enabled,
    setEnabled,
    getCharacterStats,
    getGlobalStats,
    resetCharacterStats,
    resetAllStats,
  } = useStatsStore();

  const characterStats = characterId ? getCharacterStats(characterId) : undefined;
  const globalStats = getGlobalStats();

  // 计算聊天时长
  const chatDuration = useMemo(() => {
    if (!characterStats?.dateFirstChat || !characterStats?.dateLastChat) return 0;
    return characterStats.dateLastChat - characterStats.dateFirstChat;
  }, [characterStats]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>聊天统计</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              <h4 className="font-medium">聊天统计</h4>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <>
              {/* 角色统计 */}
              {characterStats ? (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {characterName || '当前角色'}
                      </Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => characterId && resetCharacterStats(characterId)}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                    
                    <div className="bg-muted/50 rounded-lg p-2 space-y-0.5">
                      <StatItem
                        icon={MessageSquare}
                        label="消息总数"
                        value={characterStats.userMsgCount + characterStats.charMsgCount}
                      />
                      <StatItem
                        icon={User}
                        label="用户消息"
                        value={characterStats.userMsgCount}
                        subValue={`${characterStats.userWordCount}字`}
                      />
                      <StatItem
                        icon={Bot}
                        label="角色消息"
                        value={characterStats.charMsgCount}
                        subValue={`${characterStats.charWordCount}字`}
                      />
                      <StatItem
                        icon={RefreshCw}
                        label="Swipe 次数"
                        value={characterStats.totalSwipeCount}
                      />
                      <StatItem
                        icon={Clock}
                        label="生成时间"
                        value={formatDuration(characterStats.totalGenTime)}
                      />
                      <StatItem
                        icon={Calendar}
                        label="首次聊天"
                        value={formatDate(characterStats.dateFirstChat)}
                      />
                      <StatItem
                        icon={Calendar}
                        label="最后聊天"
                        value={formatDate(characterStats.dateLastChat)}
                      />
                    </div>
                  </div>

                  <Separator />
                </>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-2">
                  选择角色查看统计
                </div>
              )}

              {/* 全局统计 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">全局统计</Label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={resetAllStats}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
                
                <div className="bg-muted/50 rounded-lg p-2 space-y-0.5">
                  <StatItem
                    icon={Bot}
                    label="角色数量"
                    value={globalStats.totalCharacters}
                  />
                  <StatItem
                    icon={MessageSquare}
                    label="消息总数"
                    value={globalStats.totalMessages}
                  />
                  <StatItem
                    icon={Type}
                    label="总字数"
                    value={(globalStats.totalUserWords + globalStats.totalCharWords).toLocaleString()}
                  />
                  <StatItem
                    icon={Clock}
                    label="总生成时间"
                    value={formatDuration(globalStats.totalGenTime)}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
