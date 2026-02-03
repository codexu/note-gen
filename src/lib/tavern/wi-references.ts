/**
 * World Info 引用系统
 * 支持条目间引用 {{ref::entry_name}} 语法
 */

import { TavernWorldInfoEntry } from '@/db/tavern'

// ============ 类型定义 ============

/**
 * 引用类型
 */
export type ReferenceType = 
  | 'ref'      // 基本引用 {{ref::name}}
  | 'include'  // 包含引用 {{include::name}} - 无条件包含
  | 'ifvar'    // 条件引用 {{ifvar::varname::value::content}}
  | 'unless'   // 否定条件 {{unless::varname::value::content}}

/**
 * 解析后的引用
 */
export interface ParsedReference {
  type: ReferenceType
  fullMatch: string
  /** 引用的条目名称或 UID */
  target: string
  /** 额外参数 */
  params?: string[]
  /** 原始位置 */
  startIndex: number
  endIndex: number
}

/**
 * 引用解析上下文
 */
export interface ReferenceContext {
  /** 所有可用条目（按 UID 索引） */
  entriesByUid: Map<string, TavernWorldInfoEntry>
  /** 所有可用条目（按名称/注释索引） */
  entriesByName: Map<string, TavernWorldInfoEntry>
  /** 变量值 */
  variables: Record<string, string>
  /** 当前递归深度 */
  depth: number
  /** 最大递归深度 */
  maxDepth: number
  /** 已访问的条目（防止循环引用） */
  visited: Set<string>
}

/**
 * 引用解析结果
 */
export interface ResolveResult {
  /** 解析后的内容 */
  content: string
  /** 引用的条目 ID 列表 */
  referencedEntries: number[]
  /** 是否有循环引用 */
  hasCircularReference: boolean
  /** 解析的引用数量 */
  totalReferences: number
}

// ============ 正则表达式 ============

/** 基本引用匹配: {{ref::name}} 或 {{include::name}} */
const BASIC_REF_REGEX = /\{\{(ref|include)::([^}]+)\}\}/g

/** 条件引用匹配: {{ifvar::varname::value::content}} */
const IFVAR_REGEX = /\{\{ifvar::([^:]+)::([^:]+)::([^}]+)\}\}/g

/** 否定条件匹配: {{unless::varname::value::content}} */
const UNLESS_REGEX = /\{\{unless::([^:]+)::([^:]+)::([^}]+)\}\}/g

/** 嵌套宏保护（避免处理其他宏） */
const NESTED_MACRO_REGEX = /\{\{(?!ref|include|ifvar|unless)[^}]+\}\}/g

// ============ 主要函数 ============

/**
 * 解析内容中的所有引用
 */
export function parseReferences(content: string): ParsedReference[] {
  const references: ParsedReference[] = []
  
  // 解析基本引用
  let match: RegExpExecArray | null
  const basicRegex = new RegExp(BASIC_REF_REGEX.source, 'g')
  while ((match = basicRegex.exec(content)) !== null) {
    references.push({
      type: match[1] as ReferenceType,
      fullMatch: match[0],
      target: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }
  
  // 解析条件引用
  const ifvarRegex = new RegExp(IFVAR_REGEX.source, 'g')
  while ((match = ifvarRegex.exec(content)) !== null) {
    references.push({
      type: 'ifvar',
      fullMatch: match[0],
      target: match[1].trim(),
      params: [match[2].trim(), match[3].trim()],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }
  
  // 解析否定条件
  const unlessRegex = new RegExp(UNLESS_REGEX.source, 'g')
  while ((match = unlessRegex.exec(content)) !== null) {
    references.push({
      type: 'unless',
      fullMatch: match[0],
      target: match[1].trim(),
      params: [match[2].trim(), match[3].trim()],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })
  }
  
  // 按位置排序
  references.sort((a, b) => a.startIndex - b.startIndex)
  
  return references
}

/**
 * 检查内容是否包含引用
 */
export function hasReferences(content: string): boolean {
  return BASIC_REF_REGEX.test(content) || 
         IFVAR_REGEX.test(content) || 
         UNLESS_REGEX.test(content)
}

/**
 * 创建引用解析上下文
 */
export function createReferenceContext(
  entries: TavernWorldInfoEntry[],
  variables?: Record<string, string>,
  maxDepth: number = 10
): ReferenceContext {
  const entriesByUid = new Map<string, TavernWorldInfoEntry>()
  const entriesByName = new Map<string, TavernWorldInfoEntry>()
  
  for (const entry of entries) {
    // 按 UID 索引
    entriesByUid.set(String(entry.uid), entry)
    
    // 按注释（名称）索引
    if (entry.comment) {
      entriesByName.set(entry.comment.toLowerCase(), entry)
    }
    
    // 按关键词索引（第一个关键词作为别名）
    try {
      const keys = JSON.parse(entry.keys || '[]')
      if (Array.isArray(keys) && keys.length > 0 && keys[0]) {
        entriesByName.set(keys[0].toLowerCase(), entry)
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  return {
    entriesByUid,
    entriesByName,
    variables: variables || {},
    depth: 0,
    maxDepth,
    visited: new Set(),
  }
}

/**
 * 解析条目内容中的引用
 */
export function resolveReferences(
  content: string,
  context: ReferenceContext
): ResolveResult {
  const result: ResolveResult = {
    content,
    referencedEntries: [],
    hasCircularReference: false,
    totalReferences: 0,
  }
  
  // 检查递归深度
  if (context.depth >= context.maxDepth) {
    return result
  }
  
  const references = parseReferences(content)
  if (references.length === 0) {
    return result
  }
  
  result.totalReferences = references.length
  
  // 从后往前替换，保持索引正确
  let resolvedContent = content
  for (let i = references.length - 1; i >= 0; i--) {
    const ref = references[i]
    const replacement = resolveReference(ref, context, result)
    resolvedContent = 
      resolvedContent.slice(0, ref.startIndex) + 
      replacement + 
      resolvedContent.slice(ref.endIndex)
  }
  
  result.content = resolvedContent
  return result
}

/**
 * 解析单个引用
 */
function resolveReference(
  ref: ParsedReference,
  context: ReferenceContext,
  result: ResolveResult
): string {
  switch (ref.type) {
    case 'ref':
    case 'include':
      return resolveEntryReference(ref, context, result)
    case 'ifvar':
      return resolveIfvarReference(ref, context, result)
    case 'unless':
      return resolveUnlessReference(ref, context, result)
    default:
      return ref.fullMatch
  }
}

/**
 * 解析条目引用
 */
function resolveEntryReference(
  ref: ParsedReference,
  context: ReferenceContext,
  result: ResolveResult
): string {
  const target = ref.target.toLowerCase()
  
  // 查找条目
  let entry = context.entriesByUid.get(ref.target) || 
              context.entriesByName.get(target)
  
  if (!entry) {
    // 未找到条目，返回空或保留原文
    return ref.type === 'include' ? '' : ref.fullMatch
  }
  
  // 检查循环引用
  const entryKey = `${entry.worldInfoId}_${entry.uid}`
  if (context.visited.has(entryKey)) {
    result.hasCircularReference = true
    return `[循环引用: ${ref.target}]`
  }
  
  // 记录引用
  result.referencedEntries.push(entry.id)
  
  // 获取条目内容
  let entryContent = entry.content || ''
  
  // 递归解析引用
  if (hasReferences(entryContent)) {
    const newContext: ReferenceContext = {
      ...context,
      depth: context.depth + 1,
      visited: new Set([...context.visited, entryKey]),
    }
    const nestedResult = resolveReferences(entryContent, newContext)
    entryContent = nestedResult.content
    result.referencedEntries.push(...nestedResult.referencedEntries)
    result.hasCircularReference = result.hasCircularReference || nestedResult.hasCircularReference
    result.totalReferences += nestedResult.totalReferences
  }
  
  return entryContent
}

/**
 * 解析条件引用 (ifvar)
 */
function resolveIfvarReference(
  ref: ParsedReference,
  context: ReferenceContext,
  result: ResolveResult
): string {
  if (!ref.params || ref.params.length < 2) {
    return ''
  }
  
  const [expectedValue, content] = ref.params
  const actualValue = context.variables[ref.target] || ''
  
  // 检查条件
  if (actualValue === expectedValue) {
    // 递归解析内容中的引用
    if (hasReferences(content)) {
      const nestedResult = resolveReferences(content, {
        ...context,
        depth: context.depth + 1,
      })
      result.referencedEntries.push(...nestedResult.referencedEntries)
      return nestedResult.content
    }
    return content
  }
  
  return ''
}

/**
 * 解析否定条件引用 (unless)
 */
function resolveUnlessReference(
  ref: ParsedReference,
  context: ReferenceContext,
  result: ResolveResult
): string {
  if (!ref.params || ref.params.length < 2) {
    return ''
  }
  
  const [expectedValue, content] = ref.params
  const actualValue = context.variables[ref.target] || ''
  
  // 检查条件（与 ifvar 相反）
  if (actualValue !== expectedValue) {
    // 递归解析内容中的引用
    if (hasReferences(content)) {
      const nestedResult = resolveReferences(content, {
        ...context,
        depth: context.depth + 1,
      })
      result.referencedEntries.push(...nestedResult.referencedEntries)
      return nestedResult.content
    }
    return content
  }
  
  return ''
}

// ============ 工具函数 ============

/**
 * 提取内容中引用的条目名称列表
 */
export function extractReferencedNames(content: string): string[] {
  const references = parseReferences(content)
  return references
    .filter(r => r.type === 'ref' || r.type === 'include')
    .map(r => r.target)
}

/**
 * 构建条目依赖图
 */
export function buildDependencyGraph(
  entries: TavernWorldInfoEntry[]
): Map<number, number[]> {
  const context = createReferenceContext(entries)
  const graph = new Map<number, number[]>()
  
  for (const entry of entries) {
    const refs = extractReferencedNames(entry.content || '')
    const dependencies: number[] = []
    
    for (const refName of refs) {
      const refEntry = context.entriesByUid.get(refName) || 
                       context.entriesByName.get(refName.toLowerCase())
      if (refEntry) {
        dependencies.push(refEntry.id)
      }
    }
    
    graph.set(entry.id, dependencies)
  }
  
  return graph
}

/**
 * 检测循环依赖
 */
export function detectCircularDependencies(
  entries: TavernWorldInfoEntry[]
): Array<{ entryId: number; cycle: number[] }> {
  const graph = buildDependencyGraph(entries)
  const cycles: Array<{ entryId: number; cycle: number[] }> = []
  
  const visited = new Set<number>()
  const recursionStack = new Set<number>()
  const path: number[] = []
  
  function dfs(entryId: number): boolean {
    visited.add(entryId)
    recursionStack.add(entryId)
    path.push(entryId)
    
    const dependencies = graph.get(entryId) || []
    for (const depId of dependencies) {
      if (!visited.has(depId)) {
        if (dfs(depId)) {
          return true
        }
      } else if (recursionStack.has(depId)) {
        // 找到循环
        const cycleStart = path.indexOf(depId)
        cycles.push({
          entryId: depId,
          cycle: path.slice(cycleStart),
        })
        return true
      }
    }
    
    path.pop()
    recursionStack.delete(entryId)
    return false
  }
  
  for (const entry of entries) {
    if (!visited.has(entry.id)) {
      dfs(entry.id)
    }
  }
  
  return cycles
}

/**
 * 按拓扑顺序排序条目（确保被引用的条目先处理）
 */
export function topologicalSort(
  entries: TavernWorldInfoEntry[]
): TavernWorldInfoEntry[] {
  const graph = buildDependencyGraph(entries)
  const entryMap = new Map(entries.map(e => [e.id, e]))
  
  const visited = new Set<number>()
  const result: TavernWorldInfoEntry[] = []
  
  function visit(entryId: number) {
    if (visited.has(entryId)) return
    visited.add(entryId)
    
    const dependencies = graph.get(entryId) || []
    for (const depId of dependencies) {
      visit(depId)
    }
    
    const entry = entryMap.get(entryId)
    if (entry) {
      result.push(entry)
    }
  }
  
  for (const entry of entries) {
    visit(entry.id)
  }
  
  return result
}

/**
 * 验证引用语法
 */
export function validateReferenceSyntax(content: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  
  // 检查未闭合的引用
  const openBraces = (content.match(/\{\{/g) || []).length
  const closeBraces = (content.match(/\}\}/g) || []).length
  
  if (openBraces !== closeBraces) {
    errors.push(`引用括号不匹配: ${openBraces} 个 {{ 和 ${closeBraces} 个 }}`)
  }
  
  // 检查空引用
  if (/\{\{(ref|include)::\s*\}\}/.test(content)) {
    errors.push('存在空的条目引用')
  }
  
  // 检查条件引用格式
  const ifvarMatches = content.matchAll(/\{\{ifvar::([^}]*)\}\}/g)
  for (const match of ifvarMatches) {
    const parts = match[1].split('::')
    if (parts.length < 3) {
      errors.push(`条件引用格式错误: ${match[0]}，需要 {{ifvar::变量名::值::内容}}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============ 预处理函数 ============

/**
 * 预处理条目内容，解析所有引用
 */
export function preprocessEntryContent(
  entry: TavernWorldInfoEntry,
  allEntries: TavernWorldInfoEntry[],
  variables?: Record<string, string>
): string {
  const context = createReferenceContext(allEntries, variables)
  const result = resolveReferences(entry.content || '', context)
  return result.content
}

/**
 * 批量预处理条目
 */
export function preprocessEntries(
  entries: TavernWorldInfoEntry[],
  variables?: Record<string, string>
): Map<number, string> {
  const context = createReferenceContext(entries, variables)
  const results = new Map<number, string>()
  
  // 按拓扑顺序处理
  const sorted = topologicalSort(entries)
  
  for (const entry of sorted) {
    const result = resolveReferences(entry.content || '', {
      ...context,
      visited: new Set(),
    })
    results.set(entry.id, result.content)
  }
  
  return results
}
