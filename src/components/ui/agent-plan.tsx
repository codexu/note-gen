"use client";

import * as React from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
  ChevronRight,
  Brain,
  Zap,
  Eye,
  Loader2,
  Clock,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { formatConfirmationPreview } from "@/lib/agent/tool-confirmation-display";

// Type definitions from existing codebase
interface ToolCall {
  id: string;
  toolName: string;
  params: Record<string, any>;
  result?: {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
  };
  status: "pending" | "running" | "success" | "error";
  timestamp: number;
}

interface ConfirmationRecord {
  toolName: string;
  params: Record<string, any>;
  status: "pending" | "confirmed" | "cancelled";
  timestamp: number;
  scope?: "once" | "conversation";
  sessionApprovalType?: "write" | "runtime-script-skill";
  sessionApprovalSkillId?: string;
}

interface ReActStep {
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
  };
  observation?: string;
  duration?: number;
}

// Props for the unified AgentPlan component
interface AgentPlanProps {
  // Mode: 'live' for real-time execution, 'history' for saved history
  mode: "live" | "history";

  // Props for live mode
  isRunning?: boolean;
  isThinking?: boolean;
  currentThought?: string;
  thoughtHistory?: string[];
  completedSteps?: ReActStep[]; // 已完成的完整步骤
  currentAction?: string;
  currentObservation?: string;
  toolCalls?: ToolCall[];
  pendingConfirmation?: {
    toolName: string;
    params: Record<string, any>;
    previewParams?: Record<string, any>;
    originalContent?: string;
    modifiedContent?: string;
    filePath?: string;
    canApproveForSession?: boolean;
    sessionApprovalType?: "write" | "runtime-script-skill";
    sessionApprovalSkillId?: string;
  };
  confirmationHistory?: ConfirmationRecord[];
  currentStepStartTime?: number; // 当前步骤开始时间戳

  // Props for history mode
  historyJson?: string;

  // Callbacks for live mode
  onConfirm?: (scope?: "once" | "conversation") => void;
  onCancel?: () => void;

  // i18n namespace (optional, defaults to 'record.chat.input.agent')
  i18nNs?: string;

  // Embedded mode: render without outer container (for use in combined panels)
  embedded?: boolean;
}

// Internal step representation for unified display
interface DisplayStep {
  id: string;
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
  };
  observation?: string;
  status: "completed" | "in-progress" | "pending" | "need-help" | "failed";
  confirmation?: ConfirmationRecord;
  tools?: string[];
  duration?: number;  // 耗时（毫秒）
}

export function AgentPlan({
  mode,
  isRunning = false,
  isThinking = false,
  currentThought = "",
  thoughtHistory = [],
  completedSteps = [],
  currentAction = "",
  currentObservation = "",
  toolCalls = [],
  pendingConfirmation,
  confirmationHistory = [],
  currentStepStartTime,
  historyJson,
  onConfirm,
  onCancel,
  i18nNs = "record.chat.input.agent",
  embedded = false,
}: AgentPlanProps) {
  const t = useTranslations(i18nNs);
  const rootT = useTranslations();
  const [expandedTasks, setExpandedTasks] = React.useState<string[]>([]);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const thoughtRefs = React.useRef<Map<string, HTMLParagraphElement>>(new Map());
  const [currentStepDuration, setCurrentStepDuration] = React.useState<number>(0);
  const [showDiff, setShowDiff] = React.useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true);

  const scrollStepIntoView = React.useCallback((stepId: string) => {
    if (embedded) return;

    setTimeout(() => {
      const el = document.getElementById(`step-${stepId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, 50);
  }, [embedded]);

  const extractFinalAnswer = React.useCallback((content: string): string => {
    if (!content) return "";

    const normalized = content.replace(/Action:\s*Final\s*Answer:\s*/i, "Final Answer: ");
    const finalAnswerPatterns = [
      /Final Answer[:：]\s*([\s\S]*)/i,
      /最终答案[:：]?\s*([\s\S]*)/i,
    ];

    for (const pattern of finalAnswerPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return "";
  }, []);

  const getThoughtBody = React.useCallback((content: string): string => {
    if (!content) return "";

    return content
      .replace(/^Thought:\s*/i, "")
      .replace(/^思考[:：]?\s*/i, "")
      .trim();
  }, []);

  const shouldHideThoughtBlock = React.useCallback((thought?: string): boolean => {
    if (!thought) return false;

    const finalAnswer = extractFinalAnswer(thought);
    if (!finalAnswer) return false;

    const thoughtBody = getThoughtBody(thought)
      .replace(/Final Answer[:：][\s\S]*/i, "")
      .replace(/最终答案[:：]?[\s\S]*/i, "")
      .trim();

    if (!thoughtBody) {
      return true;
    }

    const normalizeForCompare = (value: string) =>
      value
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[：:，。、“”"'`]/g, "");

    const normalizedThought = normalizeForCompare(thoughtBody);
    const normalizedAnswer = normalizeForCompare(finalAnswer);

    return !normalizedThought || normalizedAnswer.includes(normalizedThought);
  }, [extractFinalAnswer, getThoughtBody]);

  // 实时更新当前步骤的耗时
  React.useEffect(() => {
    if (mode === "live" && isRunning && currentStepStartTime) {
      // 立即更新一次
      setCurrentStepDuration(Date.now() - currentStepStartTime);

      // 设置定时器，每 100ms 更新一次
      const interval = setInterval(() => {
        setCurrentStepDuration(Date.now() - currentStepStartTime);
      }, 100);

      return () => clearInterval(interval);
    } else {
      setCurrentStepDuration(0);
    }
  }, [mode, isRunning, currentStepStartTime]);

  // Parse history JSON in history mode
  const parseHistory = (): DisplayStep[] => {
    if (mode === "live") {
      return [];
    }

    try {
      const history = JSON.parse(historyJson || "");

      // Handle new format with steps
      if (history.steps && history.steps.length > 0) {
        return history.steps.map((step: ReActStep, index: number) => {
          const toolCall = history.toolCalls?.[index];
          let status: DisplayStep["status"] = "completed";

          // 优先使用 toolCall 的实际执行状态，而不是通过文本匹配判断
          if (toolCall?.result?.success !== undefined) {
            status = toolCall.result.success ? "completed" : "failed";
          } else if (toolCall?.status) {
            switch (toolCall.status) {
              case "success":
                status = "completed";
                break;
              case "error":
                status = "failed";
                break;
              default:
                // 回退到文本匹配判断
                if (step.observation) {
                  status =
                    step.observation.includes("失败") ||
                    step.observation.includes("错误")
                      ? "failed"
                      : "completed";
                }
            }
          } else if (step.observation) {
            status =
              step.observation.includes("失败") ||
              step.observation.includes("错误")
                ? "failed"
                : "completed";
          } else if (!step.action) {
            // 只有思考没有动作和观察，说明是未完成的步骤
            status = "pending";
          }

          return {
            id: `history-${index}`,
            thought: step.thought,
            action: step.action,
            observation: step.observation,
            status,
            duration: step.duration,
            tools: toolCall ? [toolCall.toolName] : undefined,
          };
        });
      }

      // Handle old format with thought field
      if (history.thought) {
        const thoughts = history.thought.split("\n\n").filter((t: string) => t.trim());
        return thoughts.map((thought: string, index: number) => ({
          id: `history-${index}`,
          thought,
          status: "completed" as const,
        }));
      }

      return [];
    } catch {
      return [];
    }
  };

  // Convert live mode data to DisplayStep format
  const convertLiveData = (): DisplayStep[] => {
    const steps: DisplayStep[] = [];

    // 优先使用 completedSteps（包含完整的步骤信息）
    if (completedSteps && completedSteps.length > 0) {
      // 跟踪已使用的 toolCalls 索引，避免重复匹配
      const usedToolCallIndices = new Set<number>();

      completedSteps.forEach((step, index) => {
        const confirmation = confirmationHistory[index];
        let status: DisplayStep["status"] = "completed";

        // 通过工具名称匹配 toolCall（而不是索引匹配）
        // 因为 completedSteps 和 toolCalls 的数量可能不一致
        let toolCall: ToolCall | undefined = undefined;
        if (step.action) {
          // 从后往前查找，优先使用最新的未使用的 toolCall
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (!usedToolCallIndices.has(i) && toolCalls[i].toolName === step.action.tool) {
              toolCall = toolCalls[i];
              usedToolCallIndices.add(i);
              break;
            }
          }
        }

        // 优先使用 toolCall 的实际执行状态，而不是通过文本匹配判断
        if (toolCall) {
          switch (toolCall.status) {
            case "success":
              status = "completed";
              break;
            case "error":
              status = "failed";
              break;
            case "running":
              status = "in-progress";
              break;
            case "pending":
              status = "pending";
              break;
            default:
              // 如果 toolCall.status 无效，回退到文本匹配判断
              if (step.observation) {
                status =
                  step.observation.includes("失败") ||
                  step.observation.includes("错误")
                    ? "failed"
                    : "completed";
              } else if (!step.action) {
                status = "pending";
              }
          }
        } else if (step.observation) {
          // 如果没有对应的 toolCall，回退到文本匹配判断
          status =
            step.observation.includes("失败") ||
            step.observation.includes("错误")
              ? "failed"
              : "completed";
        } else if (!step.action) {
          status = "pending";
        }

        steps.push({
          id: `completed-${index}`,
          thought: step.thought,
          action: step.action,
          observation: step.observation,
          status,
          duration: step.duration,
          confirmation,
        });
      });
    } else {
      // 兼容旧的 thoughtHistory 格式
      thoughtHistory.forEach((thought, index) => {
        const confirmation = confirmationHistory[index];
        let status: DisplayStep["status"] = "completed";

        if (confirmation) {
          status =
            confirmation.status === "confirmed" ? "completed" : "failed";
        }

        steps.push({
          id: `thought-history-${index}`,
          thought,
          status,
          confirmation,
        });
      });
    }

    // Add current step
    if (currentThought || currentAction || currentObservation) {
      let status: DisplayStep["status"] = "in-progress";

      if (pendingConfirmation) {
        status = "need-help";
      } else if (currentObservation) {
        status = "completed";
      } else if (isThinking && !currentThought) {
        // 正在等待 AI 生成思考，显示为 pending 状态（会有 loading 效果）
        status = "pending";
      }

      const currentStep: DisplayStep = {
        id: "current",
        thought: currentThought || "",
        status,
        duration: currentStepDuration, // 使用实时计算的耗时
      };

      if (currentAction) {
        // Try to parse action as "toolName(params)" format
        const match = currentAction.match(/^(\w+)\((.*)\)$/);
        if (match) {
          currentStep.action = {
            tool: match[1],
            params: match[2] ? JSON.parse(match[2]) : {},
          };
        }
      }

      if (currentObservation) {
        currentStep.observation = currentObservation;
      }

      if (toolCalls.length > 0) {
        currentStep.tools = toolCalls.map((tc) => tc.toolName);
      }

      steps.push(currentStep);
    }

    // 如果正在思考但没有当前步骤内容，添加一个 loading 步骤
    if (isThinking && !currentThought && !currentAction && !currentObservation) {
      steps.push({
        id: "thinking-placeholder",
        thought: "",
        status: "pending",
        duration: currentStepDuration, // 使用实时计算的耗时
      });
    }

    return steps;
  };

  const displaySteps: DisplayStep[] =
    mode === "live" ? convertLiveData() : parseHistory();

  // Auto-scroll to bottom when content changes in live mode
  React.useEffect(() => {
    if (mode === "live" && (currentThought || currentObservation) && contentRef.current && autoScrollEnabled) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [currentThought, currentObservation, currentStepDuration, mode, autoScrollEnabled]);

  // Handle scroll to detect if user manually scrolled up
  const handleScroll = React.useCallback(() => {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScrollEnabled(isAtBottom);
  }, []);

  // Auto-scroll thought paragraph to bottom when content updates
  React.useEffect(() => {
    if (mode === "live" && currentThought) {
      const currentStepEl = thoughtRefs.current.get("current");
      if (currentStepEl && autoScrollEnabled) {
        currentStepEl.scrollTop = currentStepEl.scrollHeight;
      }
    }
  }, [currentThought, mode, autoScrollEnabled]);

  // Auto-expand current step in live mode - keep current step always expanded while running
  React.useEffect(() => {
    if (mode === "live" && displaySteps.length > 0 && isRunning) {
      const currentStepId = displaySteps[displaySteps.length - 1]?.id;
      if (currentStepId && !expandedTasks.includes(currentStepId)) {
        setExpandedTasks((prev) => {
          const newState = [...prev, currentStepId];
          // 非嵌入模式下自动展开后滚动到该步骤
          scrollStepIntoView(currentStepId);
          return newState;
        });
      }
    }
  }, [displaySteps.length, currentThought, currentObservation, isRunning, mode, expandedTasks, scrollStepIntoView]);

  const confirmationPreview = React.useMemo(() => {
    if (!pendingConfirmation) {
      return null;
    }

    return formatConfirmationPreview(
      pendingConfirmation.toolName,
      pendingConfirmation.previewParams ?? pendingConfirmation.params ?? {}
    );
  }, [pendingConfirmation]);

  const translateKey = React.useCallback((key: string, fallback: string) => {
    return rootT.has(key) ? rootT(key) : fallback;
  }, [rootT]);

  const formatFieldValue = React.useCallback((value: unknown) => {
    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      return String(value);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  // Don't render if no content in history mode
  if (mode === "history" && displaySteps.length === 0) {
    return null;
  }

  // Don't render if not running in live mode (unless there's content)
  if (mode === "live" && !isRunning && displaySteps.length === 0) {
    return null;
  }

  // Toggle step expansion
  const toggleStepExpansion = (stepId: string) => {
    // In live mode, prevent collapsing the current (in-progress) step
    if (mode === "live" && isRunning) {
      const currentStepId = displaySteps[displaySteps.length - 1]?.id;
      if (stepId === currentStepId) {
        // Don't allow collapsing the current step - keep it expanded
        return;
      }
    }
    setExpandedTasks((prev) => {
      const isExpanding = !prev.includes(stepId);
      if (isExpanding) {
        // 非嵌入模式下展开时滚动到该步骤
        scrollStepIntoView(stepId);
      }
      return prev.includes(stepId)
        ? prev.filter((id) => id !== stepId)
        : [...prev, stepId];
    });
  };

  // Handle confirmation
  const handleConfirm = (scope: "once" | "conversation" = "once") => {
    if (onConfirm) onConfirm(scope);
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
  };

  // Clean markdown syntax from text
  const cleanMarkdown = (text: string): string => {
    return text
      // Remove bold/italic markers
      .replace(/\*\*\*/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/___/g, '')
      .replace(/__/g, '')
      .replace(/_/g, '')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove strikethrough
      .replace(/~~/g, '')
      // Remove code blocks and inline code markers
      .replace(/```/g, '')
      .replace(/`/g, '')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove blockquotes
      .replace(/^>\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Extract title from step content (prioritize observation result, then action, then thought)
  const extractTitle = (step: DisplayStep): string => {
    // 特殊处理 loading 占位符
    if (step.id === "thinking-placeholder" || (!step.thought && !step.action && !step.observation)) {
      return t("thinking");
    }

    // Helper to extract meaningful text from content
    const extractFromContent = (content: string): string => {
      if (!content || !content.trim()) return '';

      const finalAnswer = extractFinalAnswer(content);
      if (finalAnswer) {
        return extractFromContent(finalAnswer);
      }

      // 预处理：移除首尾的代码块标记 ``` 及其周围的空白行
      let processedContent = content.trim();

      // 移除所有 ``` 标记及其所在行
      const lines = processedContent.split('\n');
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        // 跳过 ``` 行（不管是否有语言标识符）
        if (trimmed === '```' || trimmed.startsWith('```')) {
          return false;
        }
        return true;
      });
      processedContent = filteredLines.join('\n').trim();

      // 按行分割并过滤空行
      const contentLines = processedContent.split("\n").map(l => l.trim()).filter(l => l);

      // 尝试从第一行获取
      for (let i = 0; i < Math.min(contentLines.length, 5); i++) {
        const line = contentLines[i];

        if (!line) continue;

        // 如果是标题（## 开头），保留标题格式，移除 # 标记
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          const titleText = headerMatch[2].trim();
          if (titleText) {
            return titleText.length > 50 ? titleText.substring(0, 50) + "..." : titleText;
          }
        }

        const cleaned = cleanMarkdown(line);
        if (cleaned.length > 0) {
          return cleaned.length > 50 ? cleaned.substring(0, 50) + "..." : cleaned;
        }
      }

      // 如果都没找到，返回第一行有效内容
      const firstValidLine = contentLines.find(l => l && l.length > 0);
      return firstValidLine || '';
    };

    // Use observation first - this contains the actual result of tool execution
    if (step.observation && step.observation.trim()) {
      const title = extractFromContent(step.observation);
      if (title) return title;
    }

    // Use action if available
    if (step.action) {
      const actionText = `${step.action.tool}(...)`;
      if (actionText.length > 50) {
        return actionText.substring(0, 50) + "...";
      }
      return actionText;
    }

    // Use thought if available
    if (step.thought && step.thought.trim()) {
      const title = extractFromContent(step.thought);
      if (title) return title;
    }

    return t("thinking");
  };

  // Get status icon
  const getStatusIcon = (status: DisplayStep["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4.5 w-4.5 text-green-500" />;
      case "in-progress":
        return <CircleDotDashed className="h-4.5 w-4.5 text-blue-500" />;
      case "need-help":
        return <CircleAlert className="h-4.5 w-4.5 text-yellow-500" />;
      case "failed":
        return <CircleX className="h-4.5 w-4.5 text-red-500" />;
      case "pending":
        return <Loader2 className="h-4.5 w-4.5 text-blue-500 animate-spin" />;
      default:
        return <Circle className="h-4.5 w-4.5 text-muted-foreground" />;
    }
  };

  // 格式化耗时显示
  const formatDuration = (duration?: number): string => {
    if (duration === undefined || duration === null) return "";
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  };

  // 渲染步骤列表内容（用于 embedded 和非 embedded 模式）
  const renderSteps = () => (
    <>
      {displaySteps.map((step, index) => {
        const isLastStep = index === displaySteps.length - 1;
        // In live mode, current (last) step is always expanded
        const isExpanded = mode === "live" && isRunning && isLastStep
          ? true
          : expandedTasks.includes(step.id);
        const isCompleted = step.status === "completed";
        const isCurrentStep = mode === "live" && isRunning && isLastStep;
        const canToggle = !isCurrentStep; // Current step cannot be toggled in live mode

        return (
          <li
            key={step.id}
            id={`step-${step.id}`}
            className={`${index !== 0 ? "mt-1 pt-2" : ""}`}
          >
            {/* Step row */}
            <div className="group flex items-center gap-2 py-1">
              <div
                className={`shrink-0 ${canToggle ? "cursor-pointer" : ""}`}
                onClick={() => canToggle && toggleStepExpansion(step.id)}
              >
                <div className={canToggle ? "cursor-pointer" : ""}>
                  {getStatusIcon(step.status)}
                </div>
              </div>

              <div
                className={`flex min-w-0 grow ${canToggle ? "cursor-pointer" : ""} items-center justify-between`}
                onClick={() => canToggle && toggleStepExpansion(step.id)}
              >
                <div className="flex-1 truncate">
                  <span
                    className={`${
                      isCompleted ? "text-muted-foreground" : ""
                    }`}
                  >
                    {extractTitle(step)}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* 耗时显示 */}
                  {step.duration !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(step.duration)}
                    </span>
                  )}
                  {canToggle && (
                    <ChevronRight
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-muted mt-1 mr-2 mb-1.5 ml-6 space-y-2">
                {/* Thought */}
                {step.thought && !shouldHideThoughtBlock(step.thought) && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Brain className="size-3.5 text-blue-500 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("thought")}
                      </span>
                    </div>
                    <p
                      ref={(el) => {
                        if (step.id) {
                          if (el) thoughtRefs.current.set(step.id, el);
                          else thoughtRefs.current.delete(step.id);
                        }
                      }}
                      className="whitespace-pre-wrap max-h-40 overflow-y-auto wrap-break-word py-1"
                    >
                      {step.thought}
                    </p>
                  </div>
                )}

                {/* Action */}
                {step.action && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Zap className="size-3.5 text-yellow-500 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("action")}
                      </span>
                    </div>
                    <div className="text-xs font-mono truncate" title={JSON.stringify(step.action.params)}>
                      {step.action.tool}
                      {Object.keys(step.action.params).length > 0 ? '(...)' : '()'}
                    </div>
                  </div>
                )}

                {/* Observation */}
                {step.observation && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Eye className="size-3.5 text-green-500 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("observation")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap wrap-break-word py-1">
                      {step.observation}
                    </p>
                  </div>
                )}

                {/* Confirmation record */}
                {step.confirmation && (
                  <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                    {step.confirmation.status === "confirmed" ? (
                      <CheckCircle className="size-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="size-4 text-red-500 shrink-0" />
                    )}
                    <code className="text-sm text-muted-foreground flex-1 wrap-break-word font-mono">
                      {step.confirmation.toolName}
                    </code>
                  </div>
                )}

              </div>
            )}
          </li>
        );
      })}

      {/* Current step confirmation (live mode only) */}
      {mode === "live" && pendingConfirmation && (
        <li className="mt-1 pt-2">
          <div className="rounded-md border border-border/50 bg-muted/30 overflow-hidden">
            {/* Confirmation header */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="size-4.5 text-orange-500 shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">
                      {confirmationPreview
                        ? translateKey(
                            confirmationPreview.titleKey,
                            pendingConfirmation.toolName
                          )
                        : pendingConfirmation.toolName}
                    </span>
                    {pendingConfirmation.filePath && (
                      <span className="text-xs text-muted-foreground truncate">
                        {pendingConfirmation.filePath}
                      </span>
                    )}
                  </div>
                  {confirmationPreview && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {translateKey(
                        confirmationPreview.descriptionKey,
                        t("confirmation.description")
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Show diff button */}
                {pendingConfirmation.originalContent && pendingConfirmation.modifiedContent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowDiff(!showDiff)}
                  >
                    {showDiff ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    <span className="ml-1">Diff</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Diff view */}
            {showDiff && pendingConfirmation.originalContent && pendingConfirmation.modifiedContent && (
              <div className="border-t border-border/50">
                <DiffViewer
                  original={pendingConfirmation.originalContent}
                  modified={pendingConfirmation.modifiedContent}
                  mode="lines"
                  showLineNumbers={true}
                  maxHeight={200}
                  className="border-0 rounded-none"
                />
              </div>
            )}

            {!pendingConfirmation.originalContent &&
              !pendingConfirmation.modifiedContent &&
              confirmationPreview &&
              confirmationPreview.fields.length > 0 && (
                <div className="border-t border-border/50 px-3 py-2 space-y-2">
                  {confirmationPreview.fields.map((field) => {
                    const label = translateKey(field.labelKey, field.name);
                    const formattedValue = formatFieldValue(field.value);

                    return (
                      <div key={field.name} className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">
                          {label}
                        </div>
                        {field.displayType === "content" ? (
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-xs text-foreground">
                            {formattedValue}
                          </pre>
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-xs text-foreground">
                            {formattedValue}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            {/* Confirmation buttons */}
            <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-t border-border/50">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={handleCancel}
              >
                <XCircle className="size-4 text-red-500" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => handleConfirm("once")}
              >
                <CheckCircle className="size-4 text-green-500" />
                <span className="ml-1">允许这次</span>
              </Button>
              {pendingConfirmation.canApproveForSession && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleConfirm("conversation")}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span className="ml-1">
                    {pendingConfirmation.sessionApprovalType === "runtime-script-skill"
                      ? "本会话允许此 Skill 脚本"
                      : "本会话都允许"}
                  </span>
                </Button>
              )}
            </div>
          </div>
        </li>
      )}
    </>
  );

  // Show loading state in live mode
  if (mode === "live" && isRunning && displaySteps.length === 0) {
    return (
      <div className="w-full mb-4">
        {/* Loading 状态 */}
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          {/* 旋转的 loading 图标 */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full border-2 border-border/30" />
            <Loader2 className="size-8 animate-spin text-blue-500" />
          </div>

          {/* 状态文字 */}
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              {isThinking ? t("thinking") : t("running")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("analyzingRequest")}
            </p>
          </div>

          {/* 脉冲动画点 */}
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-blue-500/60 animate-pulse [animation-delay:0ms]" />
            <div className="size-2 rounded-full bg-blue-500/60 animate-pulse [animation-delay:150ms]" />
            <div className="size-2 rounded-full bg-blue-500/60 animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  // Embedded 模式：只返回 <li> 元素
  if (embedded) {
    return <>{renderSteps()}</>
  }

  // 标准模式：返回完整的容器
  return (
    <div className="w-full mb-4">
      {/* 步骤列表 */}
      <div className="overflow-hidden" ref={contentRef} onScroll={handleScroll}>
        <ul className="space-y-1">
          {renderSteps()}
        </ul>
      </div>
    </div>
  );
}

export default AgentPlan;
