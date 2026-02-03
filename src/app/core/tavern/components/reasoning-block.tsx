'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Brain, Clock, Edit2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useReasoningStore, type MessageReasoning, type ReasoningState } from '@/stores/tavern-reasoning';

interface ReasoningBlockProps {
  messageId: string;
  reasoning?: string;
  state?: ReasoningState;
  duration?: number;
  className?: string;
  onEdit?: (reasoning: string) => void;
}

/**
 * 格式化思考时长
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * 思考过程显示组件
 */
export function ReasoningBlock({
  messageId,
  reasoning: propReasoning,
  state: propState,
  duration: propDuration,
  className,
  onEdit,
}: ReasoningBlockProps) {
  const { settings, getMessageReasoning, setMessageReasoning } = useReasoningStore();
  
  const [isOpen, setIsOpen] = useState(settings.autoExpand);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);

  // 获取消息的思考过程数据
  const messageReasoning = getMessageReasoning(messageId);
  const reasoning = propReasoning ?? messageReasoning?.reasoning ?? '';
  const state = propState ?? messageReasoning?.state ?? 'none';
  const duration = propDuration ?? messageReasoning?.duration;

  // 自动展开设置变化时更新
  useEffect(() => {
    if (settings.autoExpand && reasoning) {
      setIsOpen(true);
    }
  }, [settings.autoExpand, reasoning]);

  // 如果没有思考过程且不在思考中，不显示
  if (!reasoning && state !== 'thinking') {
    return null;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(reasoning);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = () => {
    setEditValue(reasoning);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setMessageReasoning(messageId, {
      reasoning: editValue,
      reasoningType: 'edited',
    });
    onEdit?.(editValue);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        'rounded-lg border bg-muted/30 overflow-hidden',
        state === 'thinking' && 'border-blue-500/50 animate-pulse',
        className
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-3 py-2 h-auto hover:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Brain className={cn(
              'h-4 w-4',
              state === 'thinking' && 'text-blue-500 animate-spin'
            )} />
            <span className="text-sm font-medium">
              {state === 'thinking' ? '思考中...' : '思考过程'}
            </span>
          </div>
          
          {duration && state === 'done' && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatDuration(duration)}</span>
            </div>
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="min-h-[100px] text-sm"
                placeholder="编辑思考过程..."
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  取消
                </Button>
                <Button size="sm" onClick={handleSaveEdit}>
                  保存
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-transparent p-0 m-0 font-sans">
                  {reasoning || (state === 'thinking' ? '正在思考...' : '')}
                </pre>
              </div>
              
              {reasoning && state === 'done' && (
                <div className="flex justify-end gap-1 mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={handleEdit}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
