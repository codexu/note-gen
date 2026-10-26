export interface AgentArtifact {
  /** Workspace-relative path reported by the Skill's output scan. */
  path: string
  /** Original output location, independent of the currently selected workspace. */
  absolutePath: string
  skillId: string
  /** A failed execution's output candidate, whose contents remain unconfirmed. */
  partial: boolean
}

export interface AgentArtifactPaths {
  artifacts: AgentArtifact[]
  allowedPaths: string[]
  /** Exact text/link aliases mapped to their original absolute locations. */
  paths: Record<string, string>
}

const ARTIFACT_TOOLS = new Set(['skill_execute_script', 'skill_run_code'])
const MAX_SOURCE_DEPTH = 5
const MAX_TOOL_CALLS = 10_000

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function validSkillId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function pathText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 16_384 || /[\u0000-\u001f\u007f]/.test(value)) return undefined
  return value.replace(/\\/g, '/')
}

function absolutePath(value: unknown): string | undefined {
  const path = pathText(value)
  if (!path) return undefined
  const root = /^[a-zA-Z]:\//.test(path)
    ? path.slice(0, 3)
    : path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : undefined
  if (!root) return undefined
  const segments = path.slice(root.length).split('/').filter(Boolean)
  if (segments.some(segment => segment === '.' || segment === '..')) return undefined
  if (root === '//' && segments.length < 2) return undefined
  return `${root}${segments.join('/')}`
}

function pathIdentity(path: string): string {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path
}

interface OutputBinding {
  absoluteDirectory: string
  relativeDirectory: string
  skillId: string
}

function outputBinding(call: Record<string, unknown>, data: Record<string, unknown>): OutputBinding | undefined {
  const directory = absolutePath(data.output_directory)
  if (!directory) return undefined
  const segments = directory.split('/')
  const outputSegments = segments.at(-4) === 'outputs' && segments.at(-2) === 'runs'
    ? segments.slice(-4)
    : segments.slice(-2)
  if (outputSegments[0] !== 'outputs') return undefined
  const skillId = outputSegments[1]
  if (!validSkillId(skillId)) return undefined
  // Registered scripts use the Skill output root; generated code uses one
  // execution-specific runs directory. Never infer a root from stdout or cwd.
  if (outputSegments.length !== 2 && (outputSegments.length !== 4 || outputSegments[2] !== 'runs')) return undefined
  const params = asRecord(call.params)
  const declaredSkillId = params?.skill_id ?? data.skill_id
  if (declaredSkillId !== undefined && declaredSkillId !== skillId) return undefined
  if (data.execution_id !== undefined
    && (typeof data.execution_id !== 'string' || outputSegments[2] !== 'runs' || outputSegments[3] !== data.execution_id)) return undefined
  return { absoluteDirectory: directory, relativeDirectory: outputSegments.join('/'), skillId }
}

function artifactFromPath(value: unknown, binding: OutputBinding, partial: boolean): AgentArtifact | undefined {
  const path = pathText(value)
  if (!path) return undefined
  const absolute = absolutePath(path)
  let suffix: string
  if (absolute) {
    const prefix = `${binding.absoluteDirectory}/`
    if (!pathIdentity(absolute).startsWith(pathIdentity(prefix))) return undefined
    suffix = absolute.slice(prefix.length)
  } else {
    const prefix = `${binding.relativeDirectory}/`
    if (!path.startsWith(prefix)) return undefined
    suffix = path.slice(prefix.length)
  }
  if (!suffix || suffix.split('/').some(segment => !segment || segment === '.' || segment === '..')) return undefined
  return {
    path: `${binding.relativeDirectory}/${suffix}`,
    absolutePath: `${binding.absoluteDirectory}/${suffix}`,
    skillId: binding.skillId,
    partial,
  }
}

/** Collect only runtime-scanned Skill outputs from persisted or live calls.
 * File existence and access are checked separately when an artifact is opened. */
export function collectAgentArtifacts(...sources: unknown[]): AgentArtifact[] {
  const artifacts = new Map<string, AgentArtifact>()
  const visited = new Set<object>()
  let toolCallCount = 0

  const visit = (source: unknown, depth: number): void => {
    if (depth > MAX_SOURCE_DEPTH || toolCallCount >= MAX_TOOL_CALLS) return
    if (typeof source === 'string') {
      try { visit(JSON.parse(source) as unknown, depth + 1) } catch { /* Invalid historical JSON has no trusted outputs. */ }
      return
    }
    if (source === null || typeof source !== 'object' || visited.has(source)) return
    visited.add(source)
    if (Array.isArray(source)) {
      for (const item of source) visit(item, depth + 1)
      return
    }
    const call = asRecord(source)
    if (!call) return
    if (typeof call.toolName !== 'string') {
      if (Array.isArray(call.toolCalls)) visit(call.toolCalls, depth + 1)
      if (typeof call.agentHistory === 'string') visit(call.agentHistory, depth + 1)
      return
    }
    toolCallCount += 1
    if (!ARTIFACT_TOOLS.has(call.toolName)) return
    const result = asRecord(call.result)
    const data = asRecord(result?.data)
    if (!result || !data) return
    const binding = outputBinding(call, data)
    if (!binding) return
    const failed = result.success === false || result.ok === false || data.execution_succeeded === false
    for (const field of ['partial_output_files', 'output_files'] as const) {
      const outputPaths = data[field]
      if (!Array.isArray(outputPaths)) continue
      for (const outputPath of outputPaths) {
        const artifact = artifactFromPath(outputPath, binding, field === 'partial_output_files' || failed)
        if (!artifact) continue
        const key = pathIdentity(artifact.absolutePath)
        // Later executions supersede earlier metadata for the same file.
        artifacts.delete(key)
        artifacts.set(key, artifact)
      }
    }
  }

  for (const source of sources) visit(source, 0)
  return [...artifacts.values()]
}

export function getAgentArtifactPaths(...sources: unknown[]): AgentArtifactPaths {
  const artifacts = collectAgentArtifacts(...sources)
  const aliases = new Map<string, Set<string>>()
  for (const artifact of artifacts) {
    for (const alias of [artifact.path, artifact.absolutePath]) {
      const targets = aliases.get(alias) || new Set<string>()
      targets.add(artifact.absolutePath)
      aliases.set(alias, targets)
    }
  }
  const paths: Record<string, string> = {}
  for (const [alias, targets] of aliases) {
    // Same-named outputs from different original workspaces have no safe
    // relative alias. Their absolute links remain available independently.
    if (targets.size === 1) paths[alias] = targets.values().next().value!
  }
  return { artifacts, allowedPaths: artifacts.map(artifact => artifact.absolutePath), paths }
}
