/**
 * Tavern 预设管理器
 * 支持 SillyTavern 预设文件的导入/导出
 * 
 * ST 预设格式:
 * - Context 预设: .json 文件，包含提示词模板配置
 */

import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  TavernPreset,
  insertPreset,
  getPresetById,
  getPresets,
  updatePreset,
  deletePreset,
} from '@/db/tavern'

// ============ ST 预设数据结构 ============

// Context 预设 (提示词模板)
export interface STContextPreset {
  name?: string
  story_string: string           // 系统提示词模板
  chat_start?: string            // 对话开始标记
  example_separator?: string     // 示例分隔符
  use_stop_strings?: boolean     // 使用停止字符串
  custom_stopping_strings?: string  // 自定义停止字符串 JSON 数组 (ST 格式)
  always_force_name2?: boolean   // 强制角色名
  trim_sentences?: boolean       // 裁剪句子
  include_newline?: boolean      // 包含换行
  single_line?: boolean          // 单行模式
  // Claude 相关
  assistant_prefill?: string     // 助手预填充
  human_sysprompt_message?: string  // 人类系统提示
  use_human_for_user?: boolean   // 用户消息使用 Human
  // 扩展字段
  extensions?: Record<string, unknown>
}

// 通用预设类型
export type STPreset = STContextPreset

// ============ 预设验证 ============

/**
 * 检测预设类型
 */
export function detectPresetType(data: Record<string, unknown>): 'context' | null {
  // Context 预设特征: story_string
  if ('story_string' in data && typeof data.story_string === 'string') {
    return 'context'
  }
  return null
}

/**
 * 验证 Context 预设
 */
export function validateContextPreset(data: unknown): data is STContextPreset {
  if (!data || typeof data !== 'object') return false
  const preset = data as Record<string, unknown>
  return 'story_string' in preset && typeof preset.story_string === 'string'
}

// ============ 预设导入 ============

export interface PresetImportResult {
  success: boolean
  presetId?: number
  name?: string
  type?: 'context'
  error?: string
}

/**
 * 从 JSON 文件导入预设
 */
export async function importPresetFromFile(filePath: string): Promise<PresetImportResult> {
  try {
    const content = await readTextFile(filePath)
    const data = JSON.parse(content)
    
    const presetType = detectPresetType(data)
    if (!presetType) {
      return { success: false, error: '无法识别预设类型' }
    }
    
    // 提取名称 (从文件名或数据中)
    const fileName = filePath.split(/[/\\]/).pop() || 'Unknown'
    const name = data.name || fileName.replace(/\.json$/i, '')
    
    // 验证预设数据
    if (presetType === 'context' && !validateContextPreset(data)) {
      return { success: false, error: 'Context 预设格式无效' }
    }
    
    // 保存到数据库
    const presetId = await insertPreset({
      name,
      presetType: presetType,
      data: JSON.stringify(data),
      isDefault: false,
    })
    
    return {
      success: true,
      presetId: presetId as number,
      name,
      type: presetType,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '导入失败',
    }
  }
}

/**
 * 打开文件选择器导入预设
 */
export async function selectAndImportPreset(): Promise<PresetImportResult> {
  const selected = await open({
    multiple: false,
    filters: [{
      name: 'JSON 预设文件',
      extensions: ['json'],
    }],
  })
  
  if (!selected) {
    return { success: false, error: '未选择文件' }
  }
  
  return await importPresetFromFile(selected)
}

/**
 * 批量导入预设
 */
export async function selectAndImportPresets(): Promise<PresetImportResult[]> {
  const selected = await open({
    multiple: true,
    filters: [{
      name: 'JSON 预设文件',
      extensions: ['json'],
    }],
  })
  
  if (!selected || selected.length === 0) {
    return [{ success: false, error: '未选择文件' }]
  }
  
  const results: PresetImportResult[] = []
  for (const filePath of selected) {
    const result = await importPresetFromFile(filePath)
    results.push(result)
  }
  
  return results
}

// ============ 预设导出 ============

/**
 * 导出预设到 JSON 文件
 */
export async function exportPreset(presetId: number): Promise<boolean> {
  const preset = await getPresetById(presetId)
  if (!preset) {
    throw new Error('预设不存在')
  }
  
  const data = JSON.parse(preset.data) as STPreset
  // 确保导出的数据包含名称
  data.name = preset.name
  
  const savePath = await save({
    defaultPath: `${preset.name}.json`,
    filters: [{
      name: 'JSON 预设文件',
      extensions: ['json'],
    }],
  })
  
  if (!savePath) {
    return false
  }
  
  await writeTextFile(savePath, JSON.stringify(data, null, 2))
  return true
}

/**
 * 获取预设数据 (解析后的)
 */
export async function getPresetData<T extends STPreset>(presetId: number): Promise<T | null> {
  const preset = await getPresetById(presetId)
  if (!preset) return null
  
  try {
    return JSON.parse(preset.data) as T
  } catch {
    return null
  }
}

// ============ 预设管理 ============

/**
 * 获取所有预设
 */
export async function getAllPresets(): Promise<TavernPreset[]> {
  return await getPresets()
}

/**
 * 创建默认 Context 预设
 */
export async function createDefaultContextPreset(): Promise<number> {
  const defaultPreset: STContextPreset = {
    name: 'Default',
    story_string: `{{#if system}}{{system}}
{{/if}}{{#if wiBefore}}{{wiBefore}}
{{/if}}{{#if description}}{{description}}
{{/if}}{{#if personality}}{{char}}'s personality: {{personality}}
{{/if}}{{#if scenario}}Scenario: {{scenario}}
{{/if}}{{#if wiAfter}}{{wiAfter}}
{{/if}}{{#if persona}}{{persona}}
{{/if}}`,
    chat_start: '<START>',
    example_separator: '***',
    use_stop_strings: false,
    always_force_name2: true,
    trim_sentences: false,
    include_newline: false,
    single_line: false,
  }
  
  return await insertPreset({
    name: 'Default',
    presetType: 'context',
    data: JSON.stringify(defaultPreset),
    isDefault: true,
  }) as number
}

/**
 * 复制预设
 */
export async function duplicatePreset(presetId: number, newName?: string): Promise<number> {
  const preset = await getPresetById(presetId)
  if (!preset) {
    throw new Error('预设不存在')
  }
  
  const name = newName || `${preset.name} (Copy)`
  
  return await insertPreset({
    name,
    presetType: preset.presetType,
    data: preset.data,
    isDefault: false,
  }) as number
}

/**
 * 更新预设数据
 */
export async function updatePresetData(presetId: number, data: STPreset): Promise<void> {
  await updatePreset(presetId, {
    data: JSON.stringify(data),
  })
}

/**
 * 重命名预设
 */
export async function renamePreset(presetId: number, newName: string): Promise<void> {
  await updatePreset(presetId, { name: newName })
}

// ============ 内置预设模板 ============

export const BUILTIN_CONTEXT_TEMPLATES = {
  // 标准模板
  standard: {
    name: 'Standard',
    story_string: `{{#if system}}{{system}}
{{/if}}{{#if wiBefore}}{{wiBefore}}
{{/if}}{{#if description}}{{description}}
{{/if}}{{#if personality}}{{char}}'s personality: {{personality}}
{{/if}}{{#if scenario}}Scenario: {{scenario}}
{{/if}}{{#if wiAfter}}{{wiAfter}}
{{/if}}{{#if persona}}{{persona}}
{{/if}}`,
  },
  
  // 简洁模板
  minimal: {
    name: 'Minimal',
    story_string: `{{system}}
{{description}}
{{scenario}}`,
  },
  
  // Claude 优化模板
  claude: {
    name: 'Claude',
    story_string: `{{#if system}}{{system}}

{{/if}}{{#if description}}[Character: {{char}}]
{{description}}

{{/if}}{{#if personality}}[Personality]
{{personality}}

{{/if}}{{#if scenario}}[Scenario]
{{scenario}}

{{/if}}{{#if wiBefore}}[World Info]
{{wiBefore}}
{{/if}}{{#if wiAfter}}{{wiAfter}}
{{/if}}{{#if persona}}[User: {{user}}]
{{persona}}
{{/if}}`,
  },
}

/**
 * 安装内置预设
 */
export async function installBuiltinPresets(): Promise<void> {
  const allPresets = await getPresets()
  
  // Context 预设
  for (const [, template] of Object.entries(BUILTIN_CONTEXT_TEMPLATES)) {
    if (!allPresets.some(p => p.name === template.name)) {
      await insertPreset({
        name: template.name,
        presetType: 'context',
        data: JSON.stringify(template),
        isDefault: false,
      })
    }
  }
}

// Re-export database functions for convenience
export { getPresets, getPresetById, updatePreset, deletePreset }
