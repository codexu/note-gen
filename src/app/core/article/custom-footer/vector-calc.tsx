import { Button } from "@/components/ui/button";
import useArticleStore from "@/stores/article";
import {
  Cylinder,
  Database,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export default function VectorCalc() {
  const {
    isVectorCalculating,
    triggerVectorCalculation,
    activeFilePath,
    vectorIndexedFiles,
    lastEditTime,
  } = useArticleStore();
  const t = useTranslations("article.footer.vectorCalc");
  const [progressPercentage, setProgressPercentage] = useState(0);

  // 获取当前文件名
  const currentFilename = activeFilePath?.split("/").pop() || "";
  const isIndexed = currentFilename && vectorIndexedFiles.has(currentFilename);

  // 获取向量状态
  const getVectorStatus = () => {
    if (isVectorCalculating) return "calculating";
    if (lastEditTime > 0) return "pending";
    if (isIndexed) return "indexed";
    return "none";
  };

  const vectorStatus = getVectorStatus();

  // 进度动画效果
  useEffect(() => {
    // 计算结束后清除进度
    if (isVectorCalculating || vectorStatus === "indexed" || vectorStatus === "none") {
      setProgressPercentage(0);
      return;
    }

    if (vectorStatus === "pending" && lastEditTime > 0) {
      // 计算距离上次编辑的时间（5秒后自动计算）
      const elapsed = Date.now() - lastEditTime;

      // 如果已经超过5秒，不显示进度条
      if (elapsed >= 5000) {
        setProgressPercentage(0);
        return;
      }

      const currentProgress = (elapsed / 5000) * 100;
      setProgressPercentage(currentProgress);

      // 每隔100ms更新一次进度
      const interval = setInterval(() => {
        const elapsed = Date.now() - lastEditTime;

        // 超过5秒后清除进度
        if (elapsed >= 5000) {
          setProgressPercentage(0);
          clearInterval(interval);
          return;
        }

        const progress = (elapsed / 5000) * 100;
        setProgressPercentage(progress > 100 ? 100 : progress);
      }, 100);

      return () => clearInterval(interval);
    }
  }, [vectorStatus, lastEditTime, isVectorCalculating]);

  // 处理点击 - 任何状态都可以点击开始计算
  const handleClick = () => {
    if (!isVectorCalculating) {
      triggerVectorCalculation();
    }
  };

  // 根据状态选择图标
  const getIcon = () => {
    switch (vectorStatus) {
      case "calculating":
        return <Loader2 className="size-3.5! animate-spin text-primary relative z-10" />;
      case "pending":
        return <Database className="size-3.5! relative z-10" />;
      case "indexed":
        return <Database className="size-3.5! relative z-10" />;
      default:
        return <Cylinder className="size-3.5! text-muted-foreground relative z-10" />;
    }
  };

  // 获取显示文本
  const getDisplayText = () => {
    if (isVectorCalculating) {
      return t("status.calculating");
    }
    return null;
  };

  // 获取提示文本
  const getTooltipText = () => {
    switch (vectorStatus) {
      case "none":
        return t("tooltip.none");
      case "indexed":
        return t("tooltip.indexed");
      case "pending":
        return t("tooltip.pending");
      case "calculating":
        return t("tooltip.calculating");
      default:
        return t("tooltip.default");
    }
  };

  const displayText = getDisplayText();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative outline-none overflow-hidden h-5 px-1.5 text-xs gap-1"
      onClick={handleClick}
      disabled={isVectorCalculating}
      title={getTooltipText()}
    >
      {/* 进度条背景 */}
      {progressPercentage > 0 && (
        <div
          className="absolute inset-0 bg-primary/20 transition-all duration-100 z-0"
          style={{ width: `${progressPercentage}%` }}
        />
      )}
      {getIcon()}
      {displayText && <span className="text-xs relative z-10">{displayText}</span>}
    </Button>
  );
}
