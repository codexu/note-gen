/**
 * TavernHelper 兼容层模块
 * 提供与 SillyTavern JS-Slash-Runner 兼容的 API
 */

export {
  // 独立 API 对象
  variables as compatVariables,
  chat as compatChat,
  generate as compatGenerate,
  macros as compatMacros,
  inject as compatInject,
  events as compatEvents,
  log as compatLog,
  // 工厂函数
  createSTCompatAPI,
  installSTCompat,
} from './adapter';
