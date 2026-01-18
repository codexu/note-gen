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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

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
}

interface ReActStep {
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
  };
  observation?: string;
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
  };
  confirmationHistory?: ConfirmationRecord[];
  loadedSkills?: Array<{ // 加载的 Skills 信息
    id: string;
    name: string;
    description?: string;
  }>;
  selectedSkills?: string[]; // AI 选择的 Skill ID 列表

  // Props for history mode
  historyJson?: string;

  // Callbacks for live mode
  onConfirm?: () => void;
  onCancel?: () => void;

  // i18n namespace (optional, defaults to 'record.chat.input.agent')
  i18nNs?: string;
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
  loadedSkills = [],
  selectedSkills,
  historyJson,
  onConfirm,
  onCancel,
  i18nNs = "record.chat.input.agent",
}: AgentPlanProps) {
  const t = useTranslations(i18nNs);
  const [expandedTasks, setExpandedTasks] = React.useState<string[]>([]);
  const contentRef = React.useRef<HTMLDivElement>(null);

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

          if (step.observation) {
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
      completedSteps.forEach((step, index) => {
        const confirmation = confirmationHistory[index];
        let status: DisplayStep["status"] = "completed";

        if (step.observation) {
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
      });
    }

    return steps;
  };

  const displaySteps: DisplayStep[] =
    mode === "live" ? convertLiveData() : parseHistory();

  // Auto-scroll to bottom when content changes in live mode
  React.useEffect(() => {
    if (mode === "live" && (currentThought || currentObservation) && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [currentThought, currentObservation, mode]);

  // Auto-expand current step in live mode
  React.useEffect(() => {
    if (mode === "live" && displaySteps.length > 0) {
      const currentStepId = displaySteps[displaySteps.length - 1]?.id;
      if (currentStepId && !expandedTasks.includes(currentStepId)) {
        setExpandedTasks((prev) => [...prev, currentStepId]);
      }
    }
  }, [displaySteps.length, mode]);

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
    setExpandedTasks((prev) =>
      prev.includes(stepId)
        ? prev.filter((id) => id !== stepId)
        : [...prev, stepId]
    );
  };

  // Handle confirmation
  const handleConfirm = () => {
    if (onConfirm) onConfirm();
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

      const lines = content.split("\n").map(l => l.trim()).filter(l => l);

      // 尝试从第一行获取
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i];
        const cleaned = cleanMarkdown(line);

        // 跳过纯代码块标记行（只有 ``` 的情况）
        if (cleaned === '' || cleaned === '```') {
          continue;
        }

        // 如果是代码块开始，尝试获取下一行作为标题
        if (line === '```' || line.startsWith('```')) {
          if (i + 1 < lines.length) {
            const nextLine = cleanMarkdown(lines[i + 1]);
            if (nextLine && nextLine !== '```') {
              return nextLine.length > 50 ? nextLine.substring(0, 50) + "..." : nextLine;
            }
          }
          continue;
        }

        // 如果有有效内容，返回
        if (cleaned.length > 0) {
          return cleaned.length > 50 ? cleaned.substring(0, 50) + "..." : cleaned;
        }
      }

      // 如果都没找到，返回第一行（即使是空的）
      return lines[0] || '';
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

  // Show loading state in live mode
  if (mode === "live" && isRunning && displaySteps.length === 0) {
    // 获取选择的 Skills 详情
    const selectedSkillsDetails = selectedSkills
      ? loadedSkills?.filter(s => selectedSkills.includes(s.id)) || []
      : []

    return (
      <div className="w-full">
        <div className="bg-card border-border rounded-lg border shadow overflow-hidden">
          {/* Skills 横幅 - 显示选择的 Skills */}
          {selectedSkillsDetails && selectedSkillsDetails.length > 0 ? (
            <div className="border-b border-border/50 bg-muted/30 px-4 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">已选择 {selectedSkillsDetails.length} 个 Skills:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedSkillsDetails.map((skill) => (
                    <span
                      key={skill.id}
                      className="bg-green-500/20 text-green-600 dark:text-green-400 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      title={skill.description}
                    >
                      {skill.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : loadedSkills && loadedSkills.length > 0 && !selectedSkills ? (
            // 还没有选择 Skills 时，只显示数量
            <div className="border-b border-border/50 bg-muted/30 px-4 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">已加载 {loadedSkills.length} 个 Skills...</span>
              </div>
            </div>
          ) : null}
          <div className="p-4">
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
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground h-full overflow-auto mb-2">
      <div className="bg-card border-border rounded-lg border overflow-hidden">
        {/* Skills 横幅（仅在 live 模式且有 Skills 时显示） */}
        {mode === "live" && (
          <>
            {selectedSkills && selectedSkills.length > 0 ? (
              // 显示选择的 Skills（绿色）
              <div className="border-b border-border/50 bg-muted/30 px-4 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">已选择 {selectedSkills.length} 个 Skills:</span>
                  <div className="flex flex-wrap gap-1">
                    {(loadedSkills?.filter(s => selectedSkills.includes(s.id)) || []).map((skill) => (
                      <span
                        key={skill.id}
                        className="bg-green-500/20 text-green-600 dark:text-green-400 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        title={skill.description}
                      >
                        {skill.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : loadedSkills && loadedSkills.length > 0 ? (
              // 还没有选择 Skills 时，只显示数量
              <div className="border-b border-border/50 bg-muted/30 px-4 py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">已加载 {loadedSkills.length} 个 Skills...</span>
                </div>
              </div>
            ) : null}
          </>
        )}
        <div className="p-2 overflow-hidden" ref={contentRef}>
          <ul className="space-y-1">
            {displaySteps.map((step, index) => {
              const isExpanded = expandedTasks.includes(step.id);
              const isCompleted = step.status === "completed";

              return (
                <li
                  key={step.id}
                  className={`${index !== 0 ? "mt-1 pt-2" : ""}`}
                >
                  {/* Step row */}
                  <div className="group flex items-center px-3 py-1.5 rounded-md hover:bg-muted/50">
                    <div
                      className="mr-2 flex-shrink-0 cursor-pointer"
                      onClick={() => toggleStepExpansion(step.id)}
                    >
                      <div className="cursor-pointer">
                        {getStatusIcon(step.status)}
                      </div>
                    </div>

                    <div
                      className="flex min-w-0 flex-grow cursor-pointer items-center justify-between"
                      onClick={() => toggleStepExpansion(step.id)}
                    >
                      <div className="mr-2 flex-1 truncate">
                        <span
                          className={`${
                            isCompleted ? "text-muted-foreground" : ""
                          }`}
                        >
                          {extractTitle(step)}
                        </span>
                      </div>

                      <div className="flex flex-shrink-0 items-center">
                        <ChevronRight
                          className={`size-4 text-muted-foreground flex-shrink-0 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-muted mt-1 mr-2 mb-1.5 ml-6 space-y-2">
                      {/* Thought */}
                      {step.thought && (
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center gap-2 py-1">
                            <Brain className="size-3.5 text-blue-500 flex-shrink-0" />
                            <span className="font-medium text-xs">
                              {t("thought")}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap break-words py-1">
                            {step.thought}
                          </p>
                        </div>
                      )}

                      {/* Action */}
                      {step.action && (
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center gap-2 py-1">
                            <Zap className="size-3.5 text-yellow-500 flex-shrink-0" />
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
                            <Eye className="size-3.5 text-green-500 flex-shrink-0" />
                            <span className="font-medium text-xs">
                              {t("observation")}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap break-words py-1">
                            {step.observation}
                          </p>
                        </div>
                      )}

                      {/* Confirmation record */}
                      {step.confirmation && (
                        <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                          {step.confirmation.status === "confirmed" ? (
                            <CheckCircle className="size-4 text-green-500 flex-shrink-0" />
                          ) : (
                            <XCircle className="size-4 text-red-500 flex-shrink-0" />
                          )}
                          <code className="text-sm text-muted-foreground flex-1 break-words font-mono">
                            {step.confirmation.toolName}
                          </code>
                        </div>
                      )}

                      {/* Tools */}
                      {step.tools && step.tools.length > 0 && (
                        <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-1.5 pl-3">
                          <span className="text-muted-foreground font-medium text-xs">
                            Tools:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {step.tools.map((tool, idx) => (
                              <span
                                key={idx}
                                className="bg-secondary/40 text-secondary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                              >
                                {tool}
                              </span>
                            ))}
                          </div>
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
                <div className="group flex items-center px-3 py-1.5 rounded-md border border-border/50 bg-muted/30">
                  <Clock className="mr-2 size-4.5 text-orange-500 flex-shrink-0 animate-pulse" />
                  <code className="text-sm text-muted-foreground flex-1 truncate min-w-0 font-mono">
                    {pendingConfirmation.toolName}
                  </code>
                  <div className="flex gap-1 flex-shrink-0">
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
                      className="h-6 w-6 p-0"
                      onClick={handleConfirm}
                    >
                      <CheckCircle className="size-4 text-green-500" />
                    </Button>
                  </div>
                </div>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default AgentPlan;
