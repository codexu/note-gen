/**
 * TavernHelper 变量系统
 * 提供多作用域变量管理
 */

// 存储
export {
  VariableStore,
  getVariableStore,
  resetVariableStore,
  type VariableChangeEvent,
} from './store';

// 管理器
export {
  VariableManager,
  getVariableManager,
  resetVariableManager,
  // 便捷函数
  getVar,
  setVar,
  deleteVar,
  getGlobalVar,
  setGlobalVar,
  getChatVar,
  setChatVar,
  // 类型
  type GetVariableOptions,
  type SetVariableOptions,
  type ListVariablesOptions,
  type VariableInfo,
} from './manager';
