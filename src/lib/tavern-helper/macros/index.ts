/**
 * TavernHelper 宏系统
 * 提供文本宏解析和处理
 */

// 处理器
export {
  MacroProcessor,
  getMacroProcessor,
  resetMacroProcessor,
  type BuiltinMacroName,
} from './processor';

// 管理器
export {
  MacroManager,
  getMacroManager,
  resetMacroManager,
  // 便捷函数
  processMacros,
  registerMacro,
  registerSimpleMacro,
  hasMacros,
  // 类型
  type RegisterMacroOptions,
} from './manager';
