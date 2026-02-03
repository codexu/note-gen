/**
 * TavernHelper 生成系统
 * 提供 AI 生成、流式处理、中止控制
 */

// 生成器
export {
  Generator,
  getGenerator,
  resetGenerator,
  type GenerateStatus,
  type GenerateResult,
  type StreamCallbacks,
  type GenerationStartedEvent,
  type GenerationTokenEvent,
  type GenerationCompletedEvent,
  type GenerationErrorEvent,
} from './generator';

// 管理器
export {
  GenerateManager,
  getGenerateManager,
  resetGenerateManager,
  // 便捷函数
  generate,
  generateRaw,
  abortGeneration,
  isGenerating,
  // 类型
  type AIProvider,
} from './manager';
