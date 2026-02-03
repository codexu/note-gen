/**
 * TavernHelper 生成管理器
 * 提供高层 API、generate/generateRaw、事件触发
 */

import type {
  AIMessage,
  GenerateConfig,
  GenerateRawConfig,
  ChatMessage,
  InjectionPrompt,
} from '../core/types';
import {
  getGenerator,
  type GenerateResult,
  type StreamCallbacks,
  type GenerationStartedEvent,
  type GenerationCompletedEvent,
  type GenerationErrorEvent,
} from './generator';
import { getMessageStore } from '../messages/store';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';

/** API 提供者接口 */
export interface AIProvider {
  /** 提供者名称 */
  name: string;
  /** 执行生成 */
  generate(
    messages: AIMessage[],
    config: GenerateConfig,
    signal?: AbortSignal
  ): Promise<GenerateResult>;
  /** 执行流式生成 */
  generateStream?(
    messages: AIMessage[],
    config: GenerateConfig,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<GenerateResult>;
}

/**
 * 生成管理器类
 */
export class GenerateManager {
  private logger = getLogger().withSource('GenerateManager');
  private provider: AIProvider | null = null;
  private lastGenerationId: string | null = null;

  /**
   * 获取生成器
   */
  private get generator() {
    return getGenerator();
  }

  /**
   * 设置 AI 提供者
   */
  setProvider(provider: AIProvider): void {
    this.provider = provider;
    this.logger.info(`AI provider set: ${provider.name}`);
  }

  /**
   * 获取当前 AI 提供者
   */
  getProvider(): AIProvider | null {
    return this.provider;
  }

  /**
   * 使用当前聊天历史生成
   */
  async generate(config?: GenerateConfig): Promise<GenerateResult> {
    // 获取聊天历史
    const store = getMessageStore();
    const chatMessages = store.getByChat();
    
    // 转换为 AI 消息格式
    const messages = this.chatToAIMessages(chatMessages, config?.maxChatHistory);

    // 添加用户输入
    if (config?.userInput) {
      messages.push({
        role: 'user',
        content: config.userInput,
      });
    }

    // 构建完整消息列表
    const fullMessages = this.generator.buildMessages(
      messages,
      config?.overrides,
      config?.injects
    );

    return this.executeGenerate(fullMessages, config ?? {});
  }

  /**
   * 使用自定义消息生成（不使用预设）
   */
  async generateRaw(
    prompts: AIMessage[],
    config?: GenerateRawConfig
  ): Promise<GenerateResult> {
    // 如果有 orderedPrompts，需要构建消息
    if (config?.orderedPrompts) {
      const messages = this.buildFromOrderedPrompts(config.orderedPrompts, prompts);
      return this.executeGenerate(messages, config ?? {});
    }

    return this.executeGenerate(prompts, config ?? {});
  }

  /**
   * 执行生成
   */
  private async executeGenerate(
    messages: AIMessage[],
    config: GenerateConfig,
    callbacks?: StreamCallbacks
  ): Promise<GenerateResult> {
    // 验证配置
    this.generator.validateConfig(config);

    // 如果有提供者，使用提供者
    if (this.provider) {
      const generationId = config.generationId ?? this.generator.generateId();
      this.lastGenerationId = generationId;

      // 触发开始事件
      getEventBus().emitSync<GenerationStartedEvent>('generation:started', {
        generationId,
        config,
      });

      try {
        let result: GenerateResult;

        if (config.shouldStream && this.provider.generateStream) {
          result = await this.provider.generateStream(
            messages,
            { ...config, generationId },
            callbacks ?? {},
          );
        } else {
          result = await this.provider.generate(
            messages,
            { ...config, generationId },
          );
        }

        // 触发完成事件
        getEventBus().emitSync<GenerationCompletedEvent>('generation:completed', {
          generationId,
          result,
        });

        return result;

      } catch (error) {
        // 触发错误事件
        getEventBus().emitSync<GenerationErrorEvent>('generation:error', {
          generationId,
          error: error as Error,
        });
        throw error;
      }
    }

    // 使用内置生成器（模拟）
    return this.generator.generate(messages, config, callbacks);
  }

  /**
   * 流式生成
   */
  async generateStream(
    config: GenerateConfig,
    callbacks: StreamCallbacks
  ): Promise<GenerateResult> {
    return this.generate({ ...config, shouldStream: true });
  }

  /**
   * 中止当前生成
   */
  abort(): boolean {
    if (this.lastGenerationId) {
      return this.generator.abort(this.lastGenerationId);
    }
    return false;
  }

  /**
   * 中止指定生成
   */
  abortById(generationId: string): boolean {
    return this.generator.abort(generationId);
  }

  /**
   * 中止所有生成
   */
  abortAll(): number {
    return this.generator.abortAll();
  }

  /**
   * 检查是否正在生成
   */
  isGenerating(): boolean {
    return this.generator.hasActiveGeneration();
  }

  /**
   * 获取活跃生成数量
   */
  getActiveCount(): number {
    return this.generator.getActiveCount();
  }

  /**
   * 获取最后一次生成 ID
   */
  getLastGenerationId(): string | null {
    return this.lastGenerationId;
  }

  /**
   * 将聊天消息转换为 AI 消息
   */
  private chatToAIMessages(
    chatMessages: ChatMessage[],
    maxHistory?: number | 'all'
  ): AIMessage[] {
    let messages = chatMessages.filter((m) => !m.isHidden);

    if (maxHistory !== 'all' && typeof maxHistory === 'number') {
      messages = messages.slice(-maxHistory);
    }

    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
    }));
  }

  /**
   * 从有序提示词构建消息
   */
  private buildFromOrderedPrompts(
    orderedPrompts: GenerateRawConfig['orderedPrompts'],
    chatHistory: AIMessage[]
  ): AIMessage[] {
    if (!orderedPrompts) return chatHistory;

    const messages: AIMessage[] = [];

    for (const prompt of orderedPrompts) {
      if (typeof prompt === 'string') {
        // 内置提示词类型，暂时跳过
        // 实际实现需要从预设中获取
        continue;
      } else {
        // RolePrompt
        messages.push(prompt);
      }
    }

    return messages;
  }

  // ============ 事件监听 ============

  /**
   * 监听生成开始
   */
  onStart(callback: (event: GenerationStartedEvent) => void): () => void {
    return getEventBus().on('generation:started', callback);
  }

  /**
   * 监听生成完成
   */
  onComplete(callback: (event: GenerationCompletedEvent) => void): () => void {
    return getEventBus().on('generation:completed', callback);
  }

  /**
   * 监听生成错误
   */
  onError(callback: (event: GenerationErrorEvent) => void): () => void {
    return getEventBus().on('generation:error', callback);
  }

  /**
   * 监听生成中止
   */
  onAbort(callback: (event: { generationId: string }) => void): () => void {
    return getEventBus().on('generation:aborted', callback);
  }

  /**
   * 监听流式 token
   */
  onToken(callback: (event: { generationId: string; token: string; fullText: string }) => void): () => void {
    return getEventBus().on('generation:token', callback);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.generator.getStats();
  }
}

/** 全局生成管理器单例 */
let globalManager: GenerateManager | null = null;

/**
 * 获取全局生成管理器实例
 */
export function getGenerateManager(): GenerateManager {
  if (!globalManager) {
    globalManager = new GenerateManager();
  }
  return globalManager;
}

/**
 * 重置全局生成管理器（主要用于测试）
 */
export function resetGenerateManager(): void {
  if (globalManager) {
    globalManager.abortAll();
  }
  globalManager = null;
}

// ============ 便捷函数 ============

/**
 * 生成回复
 */
export async function generate(config?: GenerateConfig): Promise<GenerateResult> {
  return getGenerateManager().generate(config);
}

/**
 * 原始生成
 */
export async function generateRaw(
  prompts: AIMessage[],
  config?: GenerateRawConfig
): Promise<GenerateResult> {
  return getGenerateManager().generateRaw(prompts, config);
}

/**
 * 中止生成
 */
export function abortGeneration(): boolean {
  return getGenerateManager().abort();
}

/**
 * 检查是否正在生成
 */
export function isGenerating(): boolean {
  return getGenerateManager().isGenerating();
}
