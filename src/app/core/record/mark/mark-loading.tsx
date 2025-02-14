'use client'
import { MarkType } from "@/db/marks";
import { MarkQueue } from "@/stores/mark";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { _t } from '@/locales';

export function MarkLoading({mark}: {mark: MarkQueue}){
  const [timeNow, setTimeNow] = useState(Date.now())
  const timer = useRef<NodeJS.Timeout>()

  useEffect(() => {
    // 挂载时执行的操作
    timer.current = setInterval(() => {
      setTimeNow(Date.now())
    }, 1000);
    return () => {
      clearInterval(timer.current);
    };
  }, []);

  return (
    <div className="flex justify-between px-2 items-center gap-1 py-2 text-xs border-b text-zinc-500">
      <div className="flex gap-1">
        <LoaderCircle className="animate-spin size-4" />
        <span className="flex items-center gap-1 bg-zinc-500 text-white px-1 rounded">
          {MarkType[mark.type]}
        </span>
        <span>正在{mark.progress}...</span>
      </div>
      <time className="text-zinc-400" suppressHydrationWarning={true}>{Math.round((timeNow - mark.startTime) / 1000)}{_t('seconds')}</time>
    </div>
  )
}
