'use client'
import { MarkQueue } from "@/stores/mark";
import useTagStore from "@/stores/tag";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

export function MarkLoading({mark}: {mark: MarkQueue}){
  const [timeNow, setTimeNow] = useState(Date.now())
  const timer = useRef<NodeJS.Timeout | null>(null)
  const typeT = useTranslations('record.mark.type');
  const captureT = useTranslations('record.capture');
  const tags = useTagStore((state) => state.tags)
  const tagName = tags.find((tag) => tag.id === mark.tagId)?.name

  useEffect(() => {
    // 挂载时执行的操作
    timer.current = setInterval(() => {
      setTimeNow(Date.now())
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  return (
    <div className="border-b border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">
          {typeT(mark.type)}
        </span>
        <span className="min-w-0 flex-1 truncate">{mark.progress}</span>
        <time className="shrink-0 text-muted-foreground" suppressHydrationWarning>
          {captureT('elapsedSeconds', { seconds: Math.round((timeNow - mark.startTime) / 1000) })}
        </time>
      </div>
      <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
        {tagName ? `${captureT('saveTarget')}: ${tagName} · ` : ''}{captureT('processingInBackground')}
      </p>
    </div>
  )
}
