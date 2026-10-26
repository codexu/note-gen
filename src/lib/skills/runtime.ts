import { appDataDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readDir, readFile } from '@tauri-apps/plugin-fs'
import { getWorkspacePath } from '@/lib/workspace'
import { isMobileDevice } from '@/lib/check'
import { skillManager } from './manager'
import type { SkillScope, SkillScript } from './types'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_ARGUMENTS = 20
const MAX_ARGUMENT_LENGTH = 4096
const MAX_OUTPUT_FILES = 100
const MAX_OUTPUT_DEPTH = 10
const MAX_INLINE_CODE_BYTES = 128 * 1024
const OUTPUT_PATH_FLAGS = new Set([
  '--out', '--output', '--output-dir', '--out-dir', '--output-path', '-o',
])

const OUTPUT_FILE_EXTENSIONS = new Set([
  'pptx', 'pdf', 'docx', 'xlsx', 'ipynb', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'tif', 'tiff',
  'md', 'json', 'csv', 'txt', 'html', 'rtf', 'epub', 'odt', 'ods', 'odp',
])

export interface SkillRuntimeContext {
  skillId: string
  skillDir: string
  runtimeDir: string
  outputDir: string
  appArticleDir: string
  outputDirFsPath: string
  outputBaseDir?: BaseDirectory
  outputRelativeDir: string
}

export type SkillCodeLanguage = 'python' | 'javascript' | 'bash'

export interface SkillCodeExecutionRequest {
  skillId: string
  language: SkillCodeLanguage
  code: string
  args?: string[]
  timeout?: number
  signal?: AbortSignal
  expectedWorkspaceIdentity?: string
}

export interface SkillExecutionRequest {
  skillId: string
  scriptId: string
  args?: string[]
  timeout?: number
  signal?: AbortSignal
  expectedWorkspaceIdentity?: string
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
  execution_id?: string
  language?: SkillCodeLanguage
  execution_succeeded?: boolean
  artifacts_verified?: false
  failure_type?: SkillFailureType
  missing_dependency?: SkillMissingDependency
  recovery_hint?: string
  partial_output_files?: string[]
  partial_outputs?: boolean
  output_scan_error?: string
}

export type SkillFailureType = 'missing_dependency' | 'code_error' | 'timeout' | 'cancelled' | 'runtime_error' | 'output_scan_error'

export interface SkillMissingDependency {
  kind: 'npm' | 'python'
  module: string
  package_spec?: string
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

export interface SkillCommandStatus {
  name: string
  available: boolean
  path?: string
  version?: string
}

export interface SkillEnvironmentStatus {
  python: SkillPythonStatus
  node: SkillCommandStatus
  npm: SkillCommandStatus
  commands: SkillCommandStatus[]
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
    if (normalized.split('/').includes('..')) {
      throw new Error(`Path traversal is not allowed in script arguments: ${arg}`)
    }
    const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
    if (isAbsolute) {
      const allowed = [context.skillDir, context.runtimeDir, context.outputDir, context.appArticleDir]
        .some(root => isPathInside(normalized, root))
      if (!allowed) {
        throw new Error(`External path arguments are not allowed: ${arg}`)
      }
      // Normalization is only for validation. Keep drive/UNC spelling intact
      // and never reinterpret an approved absolute input as a relative output.
      validated.push(arg)
      continue
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

export async function getSkillRuntimeContext(skillId: string, scope?: SkillScope, prepareDirectories = true, expectedWorkspaceIdentity?: string): Promise<SkillRuntimeContext> {
  if (prepareDirectories && isMobileDevice()) {
    throw new Error('SKILL_RUNTIME_UNSUPPORTED_PLATFORM: Local Skill runtimes and dependency installation are available only in the desktop app. Text-only Skill instructions remain available on mobile.')
  }
  const workspace = await getWorkspacePath()
  const workspaceIdentity = getSkillWorkspaceIdentity(workspace)
  if (expectedWorkspaceIdentity !== undefined && expectedWorkspaceIdentity !== workspaceIdentity) {
    throw new Error('WORKSPACE_CHANGED: The workspace no longer matches the task that approved this Skill operation.')
  }
  const skill = skillManager.getSkill(skillId, scope)
  const fileInfo = skillManager.getSkillFileInfo(skillId, scope)
  if (!skill || !fileInfo) {
    throw new Error(`Cannot resolve Skill directory: ${skillId}`)
  }
  const appDataPath = (await appDataDir()).replace(/\\/g, '/').replace(/\/+$/, '')
  const appArticleDir = workspace.isCustom
    ? workspace.path.replace(/\\/g, '/').replace(/\/+$/, '')
    : `${appDataPath}/article`
  const packageDirectory = fileInfo.directory.replace(/\\/g, '/')
  if (packageDirectory.startsWith('/') || /^[a-zA-Z]:/.test(packageDirectory)
    || packageDirectory.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid installed Skill package directory')
  }
  const skillDir = `${skill.metadata.scope === 'global' ? appDataPath : appArticleDir}/${packageDirectory}`
  const workspaceHash = await hashText(appArticleDir)
  const runtimeScope = skill.metadata.scope === 'global' ? 'global' : `project-${workspaceHash.slice(0, 16)}`
  const runtimeOptions = { path: `skill-runtimes/${runtimeScope}/${skillId}`, baseDir: BaseDirectory.AppData }
  const outputOptions: { path: string; baseDir?: BaseDirectory } = workspace.isCustom
    ? { path: `${appArticleDir}/outputs/${skillId}` }
    : { path: `article/outputs/${skillId}`, baseDir: BaseDirectory.AppData }
  const runtimeDir = runtimeOptions.baseDir ? `${appDataPath}/${runtimeOptions.path}` : runtimeOptions.path
  const outputDir = outputOptions.baseDir ? `${appDataPath}/${outputOptions.path}` : outputOptions.path

  if (getSkillWorkspaceIdentity(await getWorkspacePath()) !== workspaceIdentity) {
    throw new Error('WORKSPACE_CHANGED: The workspace changed while preparing the Skill environment. Run the task again in the intended workspace.')
  }
  if (prepareDirectories) {
    await ensureDir(runtimeOptions.path, runtimeOptions.baseDir)
    await ensureDir(outputOptions.path, outputOptions.baseDir)
  }

  if (getSkillWorkspaceIdentity(await getWorkspacePath()) !== workspaceIdentity) {
    throw new Error('WORKSPACE_CHANGED: The workspace changed while preparing the Skill environment. Run the task again in the intended workspace.')
  }

  return {
    skillId,
    skillDir,
    runtimeDir,
    outputDir,
    appArticleDir,
    outputDirFsPath: outputOptions.path,
    outputBaseDir: outputOptions.baseDir,
    outputRelativeDir: `outputs/${skillId}`,
  }
}

export function getSkillWorkspaceIdentity(workspace: Awaited<ReturnType<typeof getWorkspacePath>>): string {
  const normalized = workspace.path.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
  return `${workspace.isCustom ? 'custom' : 'default'}:${path}`
}

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function inspectSkillPython(skillId: string, scope?: SkillScope, expectedWorkspaceIdentity?: string): Promise<SkillPythonStatus> {
  const context = await getSkillRuntimeContext(skillId, scope, true, expectedWorkspaceIdentity)
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
  signal?: AbortSignal,
  scope?: SkillScope,
  expectedWorkspaceIdentity?: string,
): Promise<SkillPythonInstallResult> {
  signal?.throwIfAborted()
  const context = await getSkillRuntimeContext(skillId, scope, true, expectedWorkspaceIdentity)
  const result = await invokeWithSkillCancellation<SkillPythonInstallResult>('install_skill_python_dependencies', {
    executionId: crypto.randomUUID(),
    skillId,
    skillRoot: context.skillDir,
    runtimeDir: context.runtimeDir,
    packages,
  }, signal)
  signal?.throwIfAborted()
  return result
}

export async function inspectSkillEnvironment(skillId: string, scope?: SkillScope, expectedWorkspaceIdentity?: string): Promise<SkillEnvironmentStatus> {
  const context = await getSkillRuntimeContext(skillId, scope, true, expectedWorkspaceIdentity)
  return invoke<SkillEnvironmentStatus>('inspect_skill_environment', {
    request: { skillId, skillRoot: context.skillDir, runtimeDir: context.runtimeDir },
  })
}

export async function installSkillNodeDependencies(
  skillId: string,
  packages: string[],
  signal?: AbortSignal,
  scope?: SkillScope,
  expectedWorkspaceIdentity?: string,
): Promise<SkillPythonInstallResult> {
  signal?.throwIfAborted()
  const context = await getSkillRuntimeContext(skillId, scope, true, expectedWorkspaceIdentity)
  const result = await invokeWithSkillCancellation<SkillPythonInstallResult>('install_skill_node_dependencies', {
    executionId: crypto.randomUUID(), skillId, skillRoot: context.skillDir, runtimeDir: context.runtimeDir, packages,
  }, signal)
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
  const executionId = crypto.randomUUID()
  return runSkillProcess('run_skill_script', {
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
  }, signal)
}

async function runSkillProcess(
  command: 'run_skill_script' | 'run_skill_code',
  request: Record<string, unknown> & { executionId: string },
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const result = await invokeWithSkillCancellation<{
    exitCode: number
    stdout: string
    stderr: string
    outputTruncated: boolean
    timedOut: boolean
    cancelled: boolean
    executionTimeMs: number
    stdoutLog: string
    stderrLog: string
  }>(command, request, signal)
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
}

async function invokeWithSkillCancellation<T>(
  command: string,
  request: Record<string, unknown> & { executionId: string },
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const { executionId } = request
  const abortHandler = () => {
    void invoke('cancel_skill_script', { executionId }).catch(error => {
      console.error('[skill-runtime] Failed to kill aborted process', error)
    })
  }
  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    return await invoke<T>(command, { request })
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}

interface SkillFailure {
  type: SkillFailureType
  message: string
  recoveryHint: string
  missingDependency?: SkillMissingDependency
}

function describeProcessFailure(result: ProcessResult, timeoutMs: number): SkillFailure {
  if (result.aborted) return { type: 'cancelled', message: 'Script execution was cancelled', recoveryHint: 'Stop this task. Do not retry a cancelled operation without a new user request.' }
  if (result.timedOut) return { type: 'timeout', message: `Script execution timed out after ${timeoutMs}ms`, recoveryHint: 'Inspect any partial outputs and the process logs. Reduce or split the failing step before requesting approval for a retry.' }
  const message = result.stderr || result.stdout || `Script failed with exit code ${result.code}`
  const nodeModule = /\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\b/.test(result.stderr)
    ? result.stderr.match(/Cannot find (?:module|package) ["']([^"']+)["']/)?.[1]
    : undefined
  if (nodeModule && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(nodeModule)) {
    return {
      type: 'missing_dependency', message,
      missingDependency: { kind: 'npm', module: nodeModule, package_spec: nodeModule },
      recoveryHint: `Node explicitly reported MODULE_NOT_FOUND for the registry package "${nodeModule}". Request approval with skill_install_node_dependencies for this exact package if the Skill requires it. Do not install automatically, infer other packages from this error, or retry until installation succeeds.`,
    }
  }
  const pythonModule = result.stderr.match(/ModuleNotFoundError:\s+No module named ["']([^"']+)["']/)?.[1]
  if (pythonModule) {
    return {
      type: 'missing_dependency', message,
      missingDependency: { kind: 'python', module: pythonModule },
      recoveryHint: `Python could not import "${pythonModule}". Read the Skill's documented distribution requirements before requesting approval with skill_install_python_dependencies; import names are not reliable PyPI package names. Do not install automatically.`,
    }
  }
  if (/\b(?:ReferenceError|TypeError|SyntaxError|RangeError):|Traceback \(most recent call last\):/.test(result.stderr)) {
    return {
      type: 'code_error', message,
      recoveryHint: 'Use the traceback and the approved source to repair only the failing code. ReferenceError, TypeError, and API misuse are code errors, not evidence of missing packages. If partial outputs exist, inspect them first; avoid regenerating the whole document solely because a later logging or preview step failed. Request approval for each corrected code run.',
    }
  }
  return {
    type: 'runtime_error', message,
    recoveryHint: 'Read the original process logs and use skill_inspect_environment to confirm the required interpreter and system commands. A shell or external program failure is not evidence of a missing npm/PyPI package. Do not guess or install packages from generic stderr. Inspect partial outputs before retrying the failing step.',
  }
}

interface SkillOutputScan {
  files: Set<string>
  error?: string
}

async function listOutputFiles(context: SkillRuntimeContext): Promise<SkillOutputScan> {
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
      if (entry.name.startsWith('.') || entry.isSymlink) continue
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      const childPath = `${directory}/${entry.name}`
      if (entry.isDirectory) {
        await walk(childPath, childRelative, depth + 1)
      } else if (entry.isFile && isOutputFile(childRelative)) {
        files.add(`${context.outputRelativeDir}/${childRelative}`)
      }
    }
  }

  try {
    await walk(context.outputDirFsPath)
    return { files }
  } catch (error) {
    return { files, error: error instanceof Error ? error.message : String(error) }
  }
}

function buildExecutionOutcome(input: {
  context: SkillRuntimeContext
  result: ProcessResult
  startedAt: number
  timeoutMs: number
  scriptId: string
  scriptHash: string
  outputFiles: string[]
  outputScanError?: string
  executionId?: string
  language?: SkillCodeLanguage
}): SkillExecutionOutcome {
  const { context, result, outputFiles, outputScanError } = input
  const executionSucceeded = result.code === 0 && !result.timedOut && !result.aborted
  const success = executionSucceeded && !outputScanError
  const failure: SkillFailure | undefined = !executionSucceeded
    ? describeProcessFailure(result, input.timeoutMs)
    : outputScanError
      ? { type: 'output_scan_error', message: `Script exited successfully, but output discovery failed: ${outputScanError}`, recoveryHint: 'The original process succeeded. Inspect the output directory and logs before retrying; repair output discovery or inspect known artifact paths instead of rerunning the whole document generation.' }
      : undefined
  const recoveryHint = failure?.recoveryHint || 'Execution completed. Output existence does not verify contents or layout. Ordinary file exports do not require visual inspection. Render and inspect document pages when the user explicitly requests layout verification or the loaded Skill requires it; only then claim that layout was verified.'
  const partialOutputFiles = success ? [] : outputFiles
  const truncationNotice = result.truncated ? '\n\n[Output truncated; full stdout/stderr are available in the returned log files.]' : ''
  return {
    success,
    error: failure?.message,
    message: [
      success
        ? `Script executed successfully (exit code: ${result.code}, time: ${Date.now() - input.startedAt}ms).`
        : executionSucceeded
          ? `Script execution completed, but output discovery is incomplete (exit code: ${result.code}).\n${failure?.message || 'Output discovery failed'}`
          : `Script execution failed (exit code: ${result.code}).\n${failure?.message || 'Unconfirmed execution result'}`,
      outputFiles.length
        ? `${success ? 'Output files (not yet verified)' : 'Partial output candidates (not verified; task remains incomplete)'}:\n${outputFiles.map(path => `- ${path}`).join('\n')}`
        : '',
      partialOutputFiles.length ? 'These files were detected before or after the failure and may already contain useful work. Inspect them and repair the failing step before regenerating the entire document. Their presence does not turn this failed execution into success.' : '',
      outputScanError ? `Output discovery error: ${outputScanError}. Original stdout, stderr, and exit code are preserved below.` : '',
      `Recovery: ${recoveryHint}`,
      `Output:\n${result.stdout || '(no output)'}${truncationNotice}`,
    ].filter(Boolean).join('\n\n'),
    data: {
      exit_code: result.code,
      execution_time_ms: Date.now() - input.startedAt,
      working_directory: context.outputDir,
      runtime_directory: context.runtimeDir,
      output_directory: context.outputDir,
      script_id: input.scriptId,
      script_hash: input.scriptHash,
      stdout: result.stdout,
      stderr: result.stderr,
      output_truncated: result.truncated,
      output_files: success ? outputFiles : [],
      partial_output_files: partialOutputFiles,
      partial_outputs: partialOutputFiles.length > 0,
      execution_succeeded: executionSucceeded,
      artifacts_verified: false,
      failure_type: failure?.type,
      missing_dependency: failure?.missingDependency,
      recovery_hint: recoveryHint,
      output_scan_error: outputScanError,
      timeout: result.timedOut,
      cancelled: result.aborted,
      stdout_log: result.stdoutLog,
      stderr_log: result.stderrLog,
      execution_id: input.executionId,
      language: input.language,
    },
  }
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
    if (skillManager.getSkill(request.skillId)?.metadata.enabled === false) throw new Error(`Skill is disabled: ${request.skillId}`)
    context = await getSkillRuntimeContext(request.skillId, undefined, true, request.expectedWorkspaceIdentity)
    script = resolveRegisteredScript(request.skillId, request.scriptId)
    const args = await validateArguments(Array.isArray(request.args) ? request.args.map(String) : [], context)
    const scriptPath = `${context.skillDir}/scripts/${script.name}`
    await verifyScriptIntegrity(scriptPath, script.sha256)
    const before = await listOutputFiles(context)
    const result = await runCommand(script, args, context, timeoutMs, request.signal)
    const after = await listOutputFiles(context)
    return buildExecutionOutcome({
      context, result, startedAt, timeoutMs,
      scriptId: script.name,
      scriptHash: script.sha256,
      outputFiles: Array.from(after.files).filter(file => !before.files.has(file)),
      outputScanError: [before.error, after.error].filter(Boolean).join('; ') || undefined,
    })
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
        execution_succeeded: false,
        artifacts_verified: false,
        failure_type: request.signal?.aborted ? 'cancelled' : 'runtime_error',
        recovery_hint: 'Execution could not be confirmed. Resolve the reported runtime, path, or approval issue before retrying; do not claim output generation succeeded.',
      },
    }
  }
}

/** Runs approved, task-specific source without changing the installed Skill package. */
export async function executeSkillCode(request: SkillCodeExecutionRequest): Promise<SkillExecutionOutcome> {
  const startedAt = Date.now()
  const timeoutMs = Math.min(Math.max(request.timeout || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)
  const executionId = crypto.randomUUID()
  let context: SkillRuntimeContext | undefined
  let codeHash = ''

  try {
    request.signal?.throwIfAborted()
    if (skillManager.getSkill(request.skillId)?.metadata.enabled === false) throw new Error(`Skill is disabled: ${request.skillId}`)
    if (!['python', 'javascript', 'bash'].includes(request.language)) throw new Error('Unsupported Skill code language')
    if (!request.code.trim() || new TextEncoder().encode(request.code).length > MAX_INLINE_CODE_BYTES || request.code.includes('\0')) {
      throw new Error(`Skill code must contain between 1 and ${MAX_INLINE_CODE_BYTES} UTF-8 bytes without NUL characters`)
    }
    const baseContext = await getSkillRuntimeContext(request.skillId, undefined, true, request.expectedWorkspaceIdentity)
    const relativeRun = `runs/${executionId}`
    context = {
      ...baseContext,
      outputDir: `${baseContext.outputDir}/${relativeRun}`,
      outputDirFsPath: `${baseContext.outputDirFsPath}/${relativeRun}`,
      outputRelativeDir: `${baseContext.outputRelativeDir}/${relativeRun}`,
    }
    await ensureDir(context.outputDirFsPath, context.outputBaseDir)
    const args = await validateArguments(request.args || [], context)
    codeHash = await hashText(request.code)
    const result = await runSkillProcess('run_skill_code', {
      executionId,
      skillId: request.skillId,
      skillRoot: context.skillDir,
      runtimeDir: context.runtimeDir,
      outputDir: context.outputDir,
      language: request.language,
      code: request.code,
      codeHash,
      args,
      timeoutMs,
    }, request.signal)
    const outputScan = await listOutputFiles(context)
    return buildExecutionOutcome({
      context, result, startedAt, timeoutMs,
      scriptId: `generated/${codeHash}`,
      scriptHash: codeHash,
      outputFiles: Array.from(outputScan.files),
      outputScanError: outputScan.error,
      executionId,
      language: request.language,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: message,
      message: `Skill code execution failed: ${message}`,
      data: {
        exit_code: -1,
        execution_time_ms: Date.now() - startedAt,
        working_directory: context?.outputDir || '',
        runtime_directory: context?.runtimeDir || '',
        output_directory: context?.outputDir || '',
        script_id: `generated/${codeHash}`,
        script_hash: codeHash,
        stdout: '',
        stderr: '',
        output_truncated: false,
        execution_id: executionId,
        language: request.language,
        execution_succeeded: false,
        artifacts_verified: false,
        failure_type: request.signal?.aborted ? 'cancelled' : 'runtime_error',
        recovery_hint: 'Execution could not be confirmed. Resolve the reported runtime, path, or approval issue before retrying; do not claim output generation succeeded.',
      },
    }
  }
}
