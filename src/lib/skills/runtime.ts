import { appDataDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readDir, readFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { skillManager } from './manager'
import { resolveSkillDirectory } from './path-utils'
import type { SkillScript } from './types'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_ARGUMENTS = 20
const MAX_ARGUMENT_LENGTH = 4096
const MAX_OUTPUT_FILES = 100
const MAX_OUTPUT_DEPTH = 10
const OUTPUT_PATH_FLAGS = new Set([
  '--out', '--output', '--output-dir', '--out-dir', '--output-path', '-o',
])

const OUTPUT_FILE_EXTENSIONS = new Set([
  'pptx', 'pdf', 'docx', 'xlsx', 'ipynb', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'md', 'json', 'csv', 'txt',
])

export interface SkillRuntimeContext {
  skillId: string
  skillDir: string
  runtimeDir: string
  outputDir: string
  appArticleDir: string
  outputDirFsPath: string
  outputBaseDir?: BaseDirectory
}

export interface SkillExecutionRequest {
  skillId: string
  scriptId: string
  args?: string[]
  timeout?: number
  signal?: AbortSignal
}

export interface SkillExecutionData {
  exit_code: number
  execution_time_ms: number
  working_directory: string
  runtime_directory: string
  output_directory: string
  script_id: string
  script_hash: string
  stdout: string
  stderr: string
  output_truncated: boolean
  output_files?: string[]
  timeout?: boolean
  cancelled?: boolean
  stdout_log?: string
  stderr_log?: string
}

export interface SkillExecutionOutcome {
  success: boolean
  error?: string
  message: string
  data: SkillExecutionData
}

export interface SkillPythonStatus {
  available: boolean
  managed: boolean
  interpreter?: string
  version?: string
}

export interface SkillPythonInstallResult {
  interpreter: string
  version: string
  packages: string[]
  stdout: string
  stderr: string
}

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
  aborted: boolean
  executionTimeMs: number
  stdoutLog: string
  stderrLog: string
}

function getExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath
  const index = fileName.lastIndexOf('.')
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase()
}

function isOutputFile(filePath: string): boolean {
  return OUTPUT_FILE_EXTENSIONS.has(getExtension(filePath))
}

function normalizeScriptId(scriptId: string): string {
  const normalized = scriptId.replace(/\\/g, '/').replace(/^scripts\//, '')
  const segments = normalized.split('/')
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid script_id: expected a registered path below scripts/')
  }
  return normalized
}

function resolveRegisteredScript(skillId: string, scriptId: string): SkillScript {
  const skill = skillManager.getSkill(skillId)
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const normalized = normalizeScriptId(scriptId)
  const script = skill.scripts.find(candidate => candidate.name.replace(/\\/g, '/') === normalized)
  if (!script) {
    throw new Error(`Script is not registered for Skill "${skillId}": ${scriptId}`)
  }
  return script
}

async function verifyScriptIntegrity(scriptPath: string, expectedHash: string): Promise<void> {
  const bytes = await readFile(scriptPath)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actualHash !== expectedHash) {
    throw new Error('Skill script changed after it was loaded. Reload the Skill before approving execution.')
  }
}

function isPathInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedParent = parent.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)
}

async function validateArguments(args: string[], context: SkillRuntimeContext): Promise<string[]> {
  if (args.length > MAX_ARGUMENTS) {
    throw new Error(`Too many script arguments: maximum is ${MAX_ARGUMENTS}`)
  }

  const validated: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.length > MAX_ARGUMENT_LENGTH || arg.includes('\0')) {
      throw new Error(`Invalid script argument: maximum length is ${MAX_ARGUMENT_LENGTH} characters`)
    }

    const normalized = arg.replace(/\\/g, '/')
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
    if (isAbsolute) {
      const allowed = [context.skillDir, context.runtimeDir, context.outputDir, context.appArticleDir]
        .some(root => isPathInside(normalized, root))
      if (!allowed) {
        throw new Error(`External path arguments are not allowed: ${arg}`)
      }
    } else if (normalized.split('/').includes('..')) {
      throw new Error(`Path traversal is not allowed in script arguments: ${arg}`)
    }

    if (normalized.startsWith('article/')) {
      validated.push(`${context.appArticleDir}/${normalized.slice('article/'.length)}`)
      continue
    }

    if (!isAbsolute && !normalized.startsWith('-')) {
      const workspacePath = `${context.appArticleDir}/${normalized}`
      if (await exists(workspacePath)) {
        validated.push(workspacePath)
        continue
      }
    }

    if (!isAbsolute && OUTPUT_PATH_FLAGS.has(args[index - 1] || '')) {
      const outputName = normalized.split('/').filter(Boolean).pop()
      if (!outputName) {
        throw new Error(`Invalid output path argument: ${arg}`)
      }
      validated.push(`${context.outputDir}/${outputName}`)
      continue
    }

    if (isOutputFile(normalized)) {
      // Relative paths with a recognized artifact extension are outputs when
      // they do not resolve to an existing workspace input. Redirect them to
      // the Skill's user-visible output directory instead of allowing a
      // script to write into its installed, read-only package directory.
      let outputRelative = normalized.replace(/^outputs?\//, '')
      if (outputRelative.startsWith(`${context.skillId}/`)) {
        outputRelative = outputRelative.slice(context.skillId.length + 1)
      }
      validated.push(`${context.outputDir}/${outputRelative}`)
      continue
    }
    validated.push(arg)
  }
  return validated
}

async function ensureDir(path: string, baseDir?: BaseDirectory): Promise<void> {
  const present = baseDir ? await exists(path, { baseDir }) : await exists(path)
  if (!present) {
    if (baseDir) {
      await mkdir(path, { baseDir, recursive: true })
    } else {
      await mkdir(path, { recursive: true })
    }
  }
}

async function resolveContext(skillId: string): Promise<SkillRuntimeContext> {
  const skill = skillManager.getSkill(skillId)
  const fileInfo = skillManager.getSkillFileInfo(skillId)
  if (!skill || !fileInfo) {
    throw new Error(`Cannot resolve Skill directory: ${skillId}`)
  }

  const skillDir = await resolveSkillDirectory(fileInfo.directory, skill.metadata.scope)
  const appDataPath = (await appDataDir()).replace(/\/$/, '')
  const appArticleDir = `${appDataPath}/article`
  const runtimeOptions = skill.metadata.scope === 'global'
    ? { path: `skill-runtimes/${skillId}`, baseDir: BaseDirectory.AppData }
    : await getFilePathOptions(`${fileInfo.directory}/runtime`)
  const outputOptions = await getFilePathOptions(`outputs/${skillId}`)
  const runtimeDir = runtimeOptions.baseDir ? `${appDataPath}/${runtimeOptions.path}` : runtimeOptions.path
  const outputDir = outputOptions.baseDir ? `${appDataPath}/${outputOptions.path}` : outputOptions.path

  await ensureDir(runtimeOptions.path, runtimeOptions.baseDir)
  await ensureDir(outputOptions.path, outputOptions.baseDir)

  return {
    skillId,
    skillDir,
    runtimeDir,
    outputDir,
    appArticleDir,
    outputDirFsPath: outputOptions.path,
    outputBaseDir: outputOptions.baseDir,
  }
}

export async function inspectSkillPython(skillId: string): Promise<SkillPythonStatus> {
  const context = await resolveContext(skillId)
  return await invoke<SkillPythonStatus>('inspect_skill_python', {
    request: {
      skillId,
      skillRoot: context.skillDir,
      runtimeDir: context.runtimeDir,
    },
  })
}

export async function installSkillPythonDependencies(
  skillId: string,
  packages: string[],
  signal?: AbortSignal
): Promise<SkillPythonInstallResult> {
  signal?.throwIfAborted()
  const context = await resolveContext(skillId)
  const result = await invoke<SkillPythonInstallResult>('install_skill_python_dependencies', {
    request: {
      skillId,
      skillRoot: context.skillDir,
      runtimeDir: context.runtimeDir,
      packages,
    },
  })
  signal?.throwIfAborted()
  return result
}

async function runCommand(
  script: SkillScript,
  args: string[],
  context: SkillRuntimeContext,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ProcessResult> {
  signal?.throwIfAborted()
  const executionId = crypto.randomUUID()
  const abortHandler = () => {
    void invoke('cancel_skill_script', { executionId }).catch(error => {
      console.error('[skill-runtime] Failed to kill aborted process', error)
    })
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    const result = await invoke<{
      exitCode: number
      stdout: string
      stderr: string
      outputTruncated: boolean
      timedOut: boolean
      cancelled: boolean
      executionTimeMs: number
      stdoutLog: string
      stderrLog: string
    }>('run_skill_script', {
      request: {
        executionId,
        skillId: context.skillId,
        skillRoot: context.skillDir,
        runtimeDir: context.runtimeDir,
        outputDir: context.outputDir,
        scriptId: script.name,
        scriptHash: script.sha256,
        scriptType: script.type,
        args,
        timeoutMs,
      },
    })
    return {
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.outputTruncated,
      timedOut: result.timedOut,
      aborted: result.cancelled,
      executionTimeMs: result.executionTimeMs,
      stdoutLog: result.stdoutLog,
      stderrLog: result.stderrLog,
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}

function describeProcessFailure(result: ProcessResult, timeoutMs: number): string {
  if (result.aborted) return 'Script execution was cancelled'
  if (result.timedOut) return `Script execution timed out after ${timeoutMs}ms`

  const missingPythonModule = result.stderr.match(
    /ModuleNotFoundError:\s+No module named ["']([^"']+)["']/
  )
  if (missingPythonModule) {
    return `Missing Python dependency "${missingPythonModule[1]}". Install it in the Python environment used by NoteGen; automatic dependency installation is disabled.`
  }

  return result.stderr || result.stdout || `Script failed with exit code ${result.code}`
}

async function listOutputFiles(context: SkillRuntimeContext): Promise<Set<string>> {
  const files = new Set<string>()

  async function walk(directory: string, relative = '', depth = 0): Promise<void> {
    if (depth > MAX_OUTPUT_DEPTH || files.size >= MAX_OUTPUT_FILES) return
    const entries = context.outputBaseDir
      ? await readDir(directory, { baseDir: context.outputBaseDir })
      : await readDir(directory)

    for (const entry of entries) {
      if (!entry.name || files.size >= MAX_OUTPUT_FILES) break
      // Output trees may legitimately contain generated repositories. Hidden
      // metadata such as .git is neither a user-facing artifact nor safe to
      // traverse through the note filesystem scope.
      if (entry.name.startsWith('.')) continue
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      const childPath = `${directory}/${entry.name}`.replace(/\/+/g, '/')
      if (entry.isDirectory) {
        await walk(childPath, childRelative, depth + 1)
      } else if (entry.isFile && isOutputFile(childRelative)) {
        files.add(`outputs/${context.skillId}/${childRelative}`)
      }
    }
  }

  await walk(context.outputDirFsPath)
  return files
}

export function getSkillScriptPermissionKey(skillId: string, scriptId: string, args: string[] = []): string | null {
  try {
    const script = resolveRegisteredScript(skillId, scriptId)
    return `${skillId}:${script.name}@sha256:${script.sha256}:args:${JSON.stringify(args.map(String))}`
  } catch {
    return null
  }
}

export async function executeSkillRuntime(request: SkillExecutionRequest): Promise<SkillExecutionOutcome> {
  const startedAt = Date.now()
  const timeoutMs = Math.min(Math.max(request.timeout || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)
  let context: SkillRuntimeContext | undefined
  let script: SkillScript | undefined

  try {
    context = await resolveContext(request.skillId)
    script = resolveRegisteredScript(request.skillId, request.scriptId)
    const args = await validateArguments(Array.isArray(request.args) ? request.args.map(String) : [], context)
    const scriptPath = `${context.skillDir}/scripts/${script.name}`.replace(/\/+/g, '/')
    await verifyScriptIntegrity(scriptPath, script.sha256)
    const before = await listOutputFiles(context)
    const result = await runCommand(script, args, context, timeoutMs, request.signal)
    const after = result.code === 0 ? await listOutputFiles(context) : new Set<string>()
    const outputFiles = Array.from(after).filter(file => !before.has(file))
    const executionTime = Date.now() - startedAt
    const success = result.code === 0 && !result.timedOut && !result.aborted
    const truncationNotice = result.truncated ? '\n\n[Output truncated to the last 50 KB / 2000 lines.]' : ''
    const failureMessage = describeProcessFailure(result, timeoutMs)

    return {
      success,
      error: success ? undefined : failureMessage,
      message: success
        ? `Script executed successfully (exit code: ${result.code}, time: ${executionTime}ms).${outputFiles.length ? `\n\nOutput files:\n${outputFiles.map(file => `- ${file}`).join('\n')}` : ''}\n\nOutput:\n${result.stdout || '(no output)'}${truncationNotice}`
        : `Script failed (exit code: ${result.code}, time: ${executionTime}ms).\n\n${failureMessage}${truncationNotice}`,
      data: {
        exit_code: result.code,
        execution_time_ms: executionTime,
        working_directory: context.outputDir,
        runtime_directory: context.runtimeDir,
        output_directory: context.outputDir,
        script_id: script.name,
        script_hash: script.sha256,
        stdout: result.stdout,
        stderr: result.stderr,
        output_truncated: result.truncated,
        output_files: outputFiles,
        timeout: result.timedOut,
        cancelled: result.aborted,
        stdout_log: result.stdoutLog,
        stderr_log: result.stderrLog,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Script execution error: ${message}`,
      message: `Script execution failed: ${message}`,
      data: {
        exit_code: -1,
        execution_time_ms: Date.now() - startedAt,
        working_directory: context?.skillDir || '',
        runtime_directory: context?.runtimeDir || '',
        output_directory: context?.outputDir || '',
        script_id: script?.name || request.scriptId,
        script_hash: script?.sha256 || '',
        stdout: '',
        stderr: '',
        output_truncated: false,
      },
    }
  }
}
