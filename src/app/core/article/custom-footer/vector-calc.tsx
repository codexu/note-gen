import { Button } from "@/components/ui/button";
import useArticleStore from "@/stores/article";
import useVectorStore from "@/stores/vector";
import { Database, DatabaseZap, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export default function VectorCalc() {
  const { 
    vectorCalcProgress, 
    isVectorCalculating, 
    executeVectorCalculation,
    pendingVectorContent 
  } = useArticleStore()
  const { isVectorDbEnabled } = useVectorStore()
  const t = useTranslations('article.footer.vectorCalc')
  const [displayProgress, setDisplayProgress] = useState(0)

  // 平滑更新进度显示
  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayProgress(prev => {
        const diff = vectorCalcProgress - prev
        if (Math.abs(diff) < 0.1) return vectorCalcProgress
        return prev + diff * 0.1
      })
    }, 16) // 60fps

    return () => clearInterval(interval)
  }, [vectorCalcProgress])

  // 如果向量数据库未启用，不显示按钮
  if (!isVectorDbEnabled) {
    return null
  }

  // 计算背景色（根据进度从透明到主题色）
  const getBackgroundStyle = () => {
    const opacity = Math.min(displayProgress / 100, 1)
    return {
      background: `linear-gradient(to right, hsl(var(--primary) / ${opacity * 0.2}) ${displayProgress}%, transparent ${displayProgress}%)`
    }
  }

  const handleClick = () => {
    if (!isVectorCalculating && pendingVectorContent) {
      executeVectorCalculation()
    }
  }

  // 根据状态选择图标
  const getIcon = () => {
    if (isVectorCalculating) {
      // 计算中：旋转的加载图标
      return <Loader2 className="size-3.5! animate-spin" />
    } else if (pendingVectorContent) {
      // 待计算：带闪电的数据库图标
      return <DatabaseZap className="size-3.5!" />
    } else {
      // 已计算：普通数据库图标
      return <Database className="size-3.5!" />
    }
  }

  // 根据状态生成tooltip文本
  const getTooltipText = () => {
    if (isVectorCalculating) {
      return t('calculating')
    } else if (pendingVectorContent) {
      return t('pending', { progress: Math.round(displayProgress) })
    } else {
      return t('synced')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 px-1 text-xs relative overflow-hidden"
      onClick={handleClick}
      disabled={isVectorCalculating || !pendingVectorContent}
      title={`${t('tooltip')} - ${getTooltipText()}`}
    >
      <div 
        className="absolute inset-0 transition-all duration-100"
        style={getBackgroundStyle()}
      />
      <div className="relative flex items-center">
        {getIcon()}
      </div>
    </Button>
  )
}
