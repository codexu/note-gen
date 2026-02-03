/**
 * TavernHelper 生成器核心模块
 * 实现 AI 生成、流式处理和中止控制
 */

import type {
  AIMessage,
  GenerateConfig,
  GenerateRawConfig,
  GenerateOverrides,
  CustomApiConfig,
  InjectionPrompt,
  OrderedPrompt,
} from '../core/types';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';
import { GenerateError, ErrorCode } from '../core/error-handler';

/** 生成状态 */
export type GenerateStatus = 'idle' | 'preparing' | 'generating' | 'streaming' | 'completed' | 'aborted' | 'error';

/** 生成结果 */
export interface GenerateResult {
  /** 生成 ID */
  generationId: string;
  /** 生成的内容 */
  content: string;
  /** 推理内容（如果有） */
  reasoning?: string;
  /** 完成原因 */
  finishReason: 'stop' | 'length' | 'abort' | 'error';
  /** 使用的 token 数量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 生成耗时（毫秒） */
  duration: number;
  /** 使用的模型 */
  model?: string;
}

/** 流式回调 */
export interface StreamCallbacks {
  /** 收到新 token */
  onToken?: (token: string, fullText: string) => void;
  /** 推理完成（用于 o1 等模型） */
  onReasoningDone?: (reasoning: string) => void;
  /** 生成完成 */
  onComplete?: (result: GenerateResult) => void;
  /** 生成错误 */
  onError?: (error: Error) => void;
  /** 生成中止 */
  onAbort?: () => void;
}

/** 生成事件数据 */
export interface GenerationStartedEvent {
  generationId: string;
  config: GenerateConfig;
}

export interface GenerationTokenEvent {
  generationId: string;
  token: string;
  fullText: string;
}

export interface GenerationCompletedEvent {
  generationId: string;
  result: GenerateResult;
}

export interface GenerationErrorEvent {
  generationId: string;
  error: Error;
}

/**
 * 生成器类
 */
export class Generator {
  private logger = getLogger().withSource('Generator');
  private activeGenerations: Map<string, AbortController> = new Map();
  private generationCounter = 0;

  /**
   * 生成唯一的生成 ID
   */
  generateId(): string {
    return `gen_${++this.generationCounter}_${Date.now()}`;
  }

  /**
   * 检查是否有活跃的生成
   */
  hasActiveGeneration(): boolean {
    return this.activeGenerations.size > 0;
  }

  /**
   * 获取活跃生成数量
   */
  getActiveCount(): number {
    return this.activeGenerations.size;
  }

  /**
   * 中止指定生成
   */
  abort(generationId: string): boolean {
    const controller = this.activeGenerations.get(generationId);
    if (controller) {
      controller.abort();
      this.activeGenerations.delete(generationId);
      this.logger.info(`Generation aborted: ${generationId}`);
      
      getEventBus().emitSync('generation:aborted', { generationId });
      return true;
    }
    return false;
  }

  /**
   * 中止所有活跃生成
   */
  abortAll(): number {
    let count = 0;
    Array.from(this.activeGenerations.entries()).forEach(([id, controller]) => {
      controller.abort();
      count++;
      getEventBus().emitSync('generation:aborted', { generationId: id });
    });
    this.activeGenerations.clear();
    this.logger.info(`Aborted ${count} generations`);
    return count;
  }

  /**
   * 执行生成（核心方法）
   * 注意：这是一个抽象实现，实际 API 调用需要由应用层提供
   */
  async generate(
    messages: AIMessage[],
    config: GenerateConfig,
    callbacks?: StreamCallbacks
  ): Promise<GenerateResult> {
    const generationId = config.generationId ?? this.generateId();
    const abortController = new AbortController();
    this.activeGenerations.set(generationId, abortController);

    const startTime = Date.now();
    let content = '';
    let reasoning = '';

    // 触发开始事件
    getEventBus().emitSync<GenerationStartedEvent>('generation:started', {
      generationId,
      config,
    });

    this.logger.info(`Generation started: ${generationId}`, {
      messageCount: messages.length,
      stream: config.shouldStream,
    });

    try {
      // 检查是否已中止
      if (abortController.signal.aborted) {
        throw new GenerateError(
          ErrorCode.GENERATE_ABORTED,
          'Generation was aborted before starting'
        );
      }

      // 这里是生成逻辑的占位符
      // 实际实现需要调用 AI API
      // 以下是模拟实现，用于演示接口

      // 模拟流式生成
      if (config.shouldStream && callbacks?.onToken) {
        const mockResponse = 'This is a mock response for demonstration purposes.';
        const tokens = mockResponse.split(' ');
        
        for (const token of tokens) {
          if (abortController.signal.aborted) {
            throw new GenerateError(ErrorCode.GENERATE_ABORTED, 'Generation aborted');
          }
          
          content += (content ? ' ' : '') + token;
          callbacks.onToken(token + ' ', content);
          
          getEventBus().emitSync<GenerationTokenEvent>('generation:token', {
            generationId,
            token: token + ' ',
            fullText: content,
          });
          
          // 模拟延迟
          await this.delay(50);
        }
      } else {
        // 非流式生成
        content = 'This is a mock response for demonstration purposes.';
      }

      const result: GenerateResult = {
        generationId,
        content,
        reasoning: reasoning || undefined,
        finishReason: 'stop',
        duration: Date.now() - startTime,
        usage: {
          promptTokens: this.estimateTokens(messages),
          completionTokens: this.estimateTokens([{ role: 'assistant', content }]),
          totalTokens: 0,
        },
      };
      result.usage!.totalTokens = result.usage!.promptTokens + result.usage!.completionTokens;

      // 触发完成事件
      getEventBus().emitSync<GenerationCompletedEvent>('generation:completed', {
        generationId,
        result,
      });

      callbacks?.onComplete?.(result);
      this.logger.info(`Generation completed: ${generationId}`, { duration: result.duration });

      return result;

    } catch (error) {
      const isAborted = abortController.signal.aborted || 
        (error instanceof GenerateError && error.code === ErrorCode.GENERATE_ABORTED);

      if (isAborted) {
        const result: GenerateResult = {
          generationId,
          content,
          finishReason: 'abort',
          duration: Date.now() - startTime,
        };
        callbacks?.onAbort?.();
        return result;
      }

      // 触发错误事件
      getEventBus().emitSync<GenerationErrorEvent>('generation:error', {
        generationId,
        error: error as Error,
      });

      callbacks?.onError?.(error as Error);
      this.logger.error(`Generation failed: ${generationId}`, error);

      throw error;

    } finally {
      this.activeGenerations.delete(generationId);
    }
  }

  /**
   * 构建消息列表
   */
  buildMessages(
    chatHistory: AIMessage[],
    overrides?: GenerateOverrides,
    injects?: InjectionPrompt[]
  ): AIMessage[] {
    const messages: AIMessage[] = [];

    // 添加系统提示词
    if (overrides?.worldInfoBefore) {
      messages.push({ role: 'system', content: overrides.worldInfoBefore });
    }

    if (overrides?.personaDescription) {
      messages.push({ role: 'system', content: overrides.personaDescription });
    }

    if (overrides?.charDescription) {
      messages.push({ role: 'system', content: overrides.charDescription });
    }

    if (overrides?.charPersonality) {
      messages.push({ role: 'system', content: overrides.charPersonality });
    }

    if (overrides?.scenario) {
      messages.push({ role: 'system', content: overrides.scenario });
    }

    if (overrides?.worldInfoAfter) {
      messages.push({ role: 'system', content: overrides.worldInfoAfter });
    }

    if (overrides?.dialogueExamples) {
      messages.push({ role: 'system', content: overrides.dialogueExamples });
    }

    // 添加聊天历史
    messages.push(...chatHistory);

    // 添加作者注释
    if (overrides?.chatHistory?.authorsNote) {
      messages.push({ role: 'system', content: overrides.chatHistory.authorsNote });
    }

    // 应用注入
    if (injects && injects.length > 0) {
      this.applyInjections(messages, injects);
    }

    return messages;
  }

  /**
   * 应用提示词注入
   */
  private applyInjections(messages: AIMessage[], injects: InjectionPrompt[]): void {
    // 按位置分组注入
    const posOrder: Record<string, number> = { before: 0, in_chat: 1, after: 2, none: 3 };
    const sortedInjects = [...injects].sort((a, b) => {
      const aOrder = posOrder[a.position] ?? 1;
      const bOrder = posOrder[b.position] ?? 1;
      return aOrder - bOrder;
    });

    for (const inject of sortedInjects) {
      // 跳过 none 位置的注入
      if (inject.position === 'none') continue;

      const message: AIMessage = {
        role: inject.role ?? 'system',
        content: inject.content,
      };

      if (inject.position === 'before') {
        // 在开头插入
        messages.unshift(message);
      } else if (inject.position === 'after') {
        // 在末尾插入
        messages.push(message);
      } else if (inject.position === 'in_chat' && inject.depth !== undefined) {
        // 按深度插入（从末尾计算）
        const index = Math.max(0, messages.length - inject.depth);
        messages.splice(index, 0, message);
      } else {
        // 默认插入到末尾
        messages.push(message);
      }
    }
  }

  /**
   * 估算 token 数量（简单估算）
   */
  private estimateTokens(messages: AIMessage[]): number {
    let chars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            chars += part.text.length;
          }
        }
      }
    }
    // 粗略估算：4 字符 ≈ 1 token
    return Math.ceil(chars / 4);
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 验证配置
   */
  validateConfig(config: GenerateConfig): void {
    if (config.customApi) {
      if (config.customApi.maxTokens !== undefined && 
          typeof config.customApi.maxTokens === 'number' &&
          config.customApi.maxTokens <= 0) {
        throw new GenerateError(
          ErrorCode.GENERATE_INVALID_CONFIG,
          'maxTokens must be positive'
        );
      }
      
      if (config.customApi.temperature !== undefined && 
          typeof config.customApi.temperature === 'number' &&
          (config.customApi.temperature < 0 || config.customApi.temperature > 2)) {
        throw new GenerateError(
          ErrorCode.GENERATE_INVALID_CONFIG,
          'temperature must be between 0 and 2'
        );
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    activeGenerations: number;
    totalGenerated: number;
  } {
    return {
      activeGenerations: this.activeGenerations.size,
      totalGenerated: this.generationCounter,
    };
  }
}

/** 全局生成器单例 */
let globalGenerator: Generator | null = null;

/**
 * 获取全局生成器实例
 */
export function getGenerator(): Generator {
  if (!globalGenerator) {
    globalGenerator = new Generator();
  }
  return globalGenerator;
}

/**
 * 重置全局生成器（主要用于测试）
 */
export function resetGenerator(): void {
  if (globalGenerator) {
    globalGenerator.abortAll();
  }
  globalGenerator = null;
}
