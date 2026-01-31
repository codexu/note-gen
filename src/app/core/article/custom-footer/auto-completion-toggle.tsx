"use client";
import { Button } from "@/components/ui/button";
import { Zap, Loader2 } from "lucide-react";
import { useLocalStorage } from "react-use";
import { useEffect, useState } from "react";
import emitter from "@/lib/emitter";

export default function AutoCompletionToggle() {
  const [isEnabled, setIsEnabled] = useLocalStorage<boolean>('auto-completion-enabled', true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleLoadingChange = (loading: unknown) => {
      setIsLoading(loading as boolean);
    };

    emitter.on('ai-completion-loading', handleLoadingChange);
    return () => {
      emitter.off('ai-completion-loading', handleLoadingChange);
    };
  }, []);

  // 同步初始状态
  useEffect(() => {
    emitter.emit('auto-completion-enabled-changed', isEnabled ?? true);
  }, []);

  const handleToggle = () => {
    const newValue = !(isEnabled ?? true);
    setIsEnabled(newValue);
    // 立即通过 emitter 发送状态变化
    emitter.emit('auto-completion-enabled-changed', newValue);
  };

  return (
    <div className="items-center gap-1 hidden md:flex">
      <Button
        variant="ghost"
        size="icon"
        className="outline-none"
        onClick={handleToggle}
        title={(isEnabled ?? true) ? "关闭 AI 自动补全" : "开启 AI 自动补全"}
      >
        {isLoading ? (
          <Loader2 className="!size-3.5 animate-spin" />
        ) : (isEnabled ?? true) ? (
          <Zap className="!size-3.5" />
        ) : (
          <Zap className="!size-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
