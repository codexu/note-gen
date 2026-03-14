import { appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, readDir, rename } from '@tauri-apps/plugin-fs'
import { Command } from '@tauri-apps/plugin-shell'
import { skillManager } from './manager'
import { buildShellCommand, resolveSkillDirectory } from './path-utils'
import { detectPythonCommand, ensureDependencyForCommand } from './dependency-installer'
import { getFilePathOptions } from '@/lib/workspace'
import { classifySkillScriptPath } from './runtime-paths'

export interface SkillRuntimeContext {
  skillId: string
  skillDir: string
  runtimeDir: string
  outputDir: string
  appArticleDir: string
  fsBaseDir?: BaseDirectory
  skillDirFsPath: string
  runtimeDirFsPath: string
  outputDirFsPath: string
}

export interface SkillExecutionRequest {
  skillId: string
  command: string
  args?: string[]
  timeout?: number
}

export interface SkillExecutionData {
  exit_code: number
  execution_time_ms: number
  working_directory: string
  runtime_directory: string
  output_directory: string
  stdout: string
  stderr: string
  dependency_installed?: string
  output_files?: string[]
  timeout?: boolean
}

export interface SkillExecutionOutcome {
  success: boolean
  error?: string
  message: string
  data: SkillExecutionData
}

const OUTPUT_FILE_EXTENSIONS = new Set([
  'pptx',
  'pdf',
  'docx',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'md',
  'json',
  'csv',
  'txt',
])

const SCRIPT_FILE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'py', 'sh', 'bash'])

function getExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath
  const index = fileName.lastIndexOf('.')
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase()
}

function isScriptLikeFile(filePath: string): boolean {
  return SCRIPT_FILE_EXTENSIONS.has(getExtension(filePath))
}

function isOutputLikeFile(filePath: string): boolean {
  return OUTPUT_FILE_EXTENSIONS.has(getExtension(filePath))
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/')
}

function isSkillBuiltInPath(filePath: string): boolean {
  return filePath.startsWith('scripts/') || filePath.startsWith('scripts\\')
}

function isSafeRelativePath(filePath: string): boolean {
  return !filePath.startsWith('..') && !isAbsolutePath(filePath)
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

async function pathExists(filePath: string, baseDir?: BaseDirectory): Promise<boolean> {
  try {
    return baseDir ? await exists(filePath, { baseDir }) : await exists(filePath)
  } catch {
    return false
  }
}

async function ensureDir(dir: string, baseDir?: BaseDirectory): Promise<void> {
  if (!(await pathExists(dir, baseDir))) {
    if (baseDir) {
      await mkdir(dir, { baseDir, recursive: true })
    } else {
      await mkdir(dir, { recursive: true })
    }
  }
}

async function resolveWritableRuntimeDir(
  fileInfoDirectory: string
): Promise<{ runtimeDirPath: string; runtimeDirFsPath: string; baseDir?: BaseDirectory }> {
  const appDataPath = await appDataDir()
  const fallbackOptions = await getFilePathOptions(`${fileInfoDirectory}/runtime`)
  await ensureDir(fallbackOptions.path, fallbackOptions.baseDir)

  return {
    runtimeDirPath: fallbackOptions.baseDir
      ? `${appDataPath}/${fallbackOptions.path}`
      : fallbackOptions.path,
    runtimeDirFsPath: fallbackOptions.path,
    baseDir: fallbackOptions.baseDir,
  }
}

async function resolveContext(skillId: string): Promise<SkillRuntimeContext> {
  const skill = skillManager.getSkill(skillId)
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const fileInfo = skillManager.getSkillFileInfo(skillId)
  if (!fileInfo) {
    throw new Error(`Cannot determine Skill directory for: ${skillId}`)
  }

  const skillDir = await resolveSkillDirectory(fileInfo.directory, skill.metadata.scope)
  const appDataPath = await appDataDir()
  const appArticleDir = `${appDataPath.replace(/\/$/, '')}/article`
  const outputDir = `${appArticleDir}/outputs/${skillId}`
  const runtimeResolution = await resolveWritableRuntimeDir(fileInfo.directory)
  const runtimeDir = runtimeResolution.runtimeDirPath
  const outputDirOptions = await getFilePathOptions(`outputs/${skillId}`)
  const skillDirOptions = await getFilePathOptions(fileInfo.directory)
  const fsBaseDir = runtimeResolution.baseDir ?? outputDirOptions.baseDir ?? skillDirOptions.baseDir

  await ensureDir(outputDirOptions.path, outputDirOptions.baseDir)

  return {
    skillId,
    skillDir,
    runtimeDir,
    outputDir,
    appArticleDir,
    fsBaseDir,
    skillDirFsPath: skillDirOptions.path,
    runtimeDirFsPath: runtimeResolution.runtimeDirFsPath,
    outputDirFsPath: outputDirOptions.path,
  }
}

async function normalizeArg(arg: string, context: SkillRuntimeContext): Promise<string> {
  if (!arg || typeof arg !== 'string') {
    return arg
  }

  if (isAbsolutePath(arg)) {
    return arg
  }

  const classified = classifySkillScriptPath(arg)
  const normalized = classified.normalizedArg

  if (isSkillBuiltInPath(normalized)) {
    return normalized
  }

  if (!normalized.includes('/') && isScriptLikeFile(normalized)) {
    const runtimeCandidate = `${context.runtimeDir}/${normalized}`
    const runtimeCandidateFsPath = `${context.runtimeDirFsPath}/${normalized}`
    if (await pathExists(runtimeCandidateFsPath, context.fsBaseDir)) {
      return runtimeCandidate
    }

    const skillRootCandidate = `${context.skillDir}/${normalized}`
    const skillRootCandidateFsPath = `${context.skillDirFsPath}/${normalized}`
    if (await pathExists(skillRootCandidateFsPath, context.fsBaseDir)) {
      return skillRootCandidate
    }

    return runtimeCandidate
  }

  if (normalized.startsWith('article/')) {
    return `${context.appArticleDir}/${normalized.replace(/^article\//, '')}`
  }

  if (normalized.startsWith('../article/')) {
    return `${context.appArticleDir}/${normalized.replace(/^\.\.\/article\//, '')}`
  }

  if (!normalized.includes('/') && isOutputLikeFile(normalized)) {
    const articleCandidate = `${context.appArticleDir}/${normalized}`
    const articleCandidateFsPath = `article/${normalized}`.replace(/^article\/article\//, 'article/')
    if (await pathExists(articleCandidateFsPath, BaseDirectory.AppData)) {
      return articleCandidate
    }

    return `${context.outputDir}/${normalized}`
  }

  if (isSafeRelativePath(normalized)) {
    const runtimeCandidate = `${context.runtimeDir}/${normalized}`
    const runtimeCandidateFsPath = `${context.runtimeDirFsPath}/${normalized}`
    if (await pathExists(runtimeCandidateFsPath, context.fsBaseDir)) {
      return runtimeCandidate
    }
  }

  return normalized
}

function parseCommand(command: string, args: string[]): { cmd: string; cmdArgs: string[] } {
  if (command.includes(' ')) {
    const commandParts = command.trim().split(/\s+/)
    return {
      cmd: commandParts[0],
      cmdArgs: [...commandParts.slice(1), ...args],
    }
  }

  return {
    cmd: command,
    cmdArgs: [...args],
  }
}

async function normalizeExecutionPlan(
  command: string,
  args: string[]
): Promise<{ command: string; args: string[] }> {
  if (command === 'python' || command === 'python3') {
    const pythonCommand = (await detectPythonCommand(command)) || command

    if (args[0] === '-m' && args[1] === 'markitdown' && args[2]) {
      return {
        command: pythonCommand,
        args: [
          '-c',
          [
            'from markitdown import MarkItDown',
            'import sys',
            'result = MarkItDown().convert(sys.argv[1])',
            'print(getattr(result, "text_content", str(result)))',
          ].join('; '),
          args[2],
        ],
      }
    }

    return {
      command: pythonCommand,
      args,
    }
  }

  if (command === 'pip' || command === 'pip3') {
    const pythonCommand = (await detectPythonCommand('python3')) || 'python3'
    return {
      command: pythonCommand,
      args: ['-m', 'pip', ...args],
    }
  }

  return {
    command,
    args,
  }
}

function determineWorkingDirectory(
  context: SkillRuntimeContext,
  command: string,
  processedArgs: string[]
): string {
  if ((command === 'node' || command === 'python' || command === 'python3' || command === 'bash' || command === 'sh') && processedArgs.length > 0) {
    const candidateScript = processedArgs.find((arg) => !arg.startsWith('-') && isScriptLikeFile(arg))
    if (candidateScript && candidateScript.startsWith(`${context.runtimeDir}/`)) {
      return context.runtimeDir
    }
  }

  return context.skillDir
}

async function snapshotOutputFiles(context: SkillRuntimeContext): Promise<Set<string>> {
  const snapshot = new Set<string>()
  const entries = context.fsBaseDir
    ? await readDir(context.outputDirFsPath, { baseDir: context.fsBaseDir })
    : await readDir(context.outputDirFsPath)

  for (const entry of entries) {
    if (entry.isFile && entry.name && isOutputLikeFile(entry.name) && !isScriptLikeFile(entry.name)) {
      snapshot.add(`outputs/${context.skillId}/${entry.name}`)
    }
  }

  return snapshot
}

async function collectGeneratedOutputs(context: SkillRuntimeContext, previousOutputs: Set<string>): Promise<string[]> {
  const movedFiles: string[] = []
  const seenTargets = new Set<string>()

  async function moveOutputFile(fullPathFs: string, relativeFromRuntime: string): Promise<void> {
    const normalizedRelativePath = toPosixPath(relativeFromRuntime).replace(/^\/+/, '')
    if (!normalizedRelativePath || !isOutputLikeFile(normalizedRelativePath) || isScriptLikeFile(normalizedRelativePath)) {
      return
    }

    const targetPathFs = `${context.outputDirFsPath}/${normalizedRelativePath}`.replace(/\/+/g, '/')
    const outputRelativePath = `outputs/${context.skillId}/${normalizedRelativePath}`.replace(/\/+/g, '/')

    if (seenTargets.has(outputRelativePath)) {
      return
    }

    seenTargets.add(outputRelativePath)

    try {
      if (fullPathFs === targetPathFs) {
        movedFiles.push(outputRelativePath)
        return
      }

      const targetDirFsPath = targetPathFs.slice(0, targetPathFs.lastIndexOf('/'))
      await ensureDir(targetDirFsPath, context.fsBaseDir)

      if (context.fsBaseDir) {
        await rename(fullPathFs, targetPathFs, {
          oldPathBaseDir: context.fsBaseDir,
          newPathBaseDir: context.fsBaseDir,
        })
      } else {
        await rename(fullPathFs, targetPathFs)
      }

      movedFiles.push(outputRelativePath)
    } catch (error) {
      console.error('[skill-runtime] Failed to move generated output', {
        source: fullPathFs,
        target: targetPathFs,
        error: String(error),
      })
    }
  }

  async function walkRuntime(currentDirFsPath: string, currentRelativeFromRuntime = ''): Promise<void> {
    const entries = context.fsBaseDir
      ? await readDir(currentDirFsPath, { baseDir: context.fsBaseDir })
      : await readDir(currentDirFsPath)

    for (const entry of entries) {
      if (!entry.name) continue

      const relativeFromRuntime = currentRelativeFromRuntime
        ? `${currentRelativeFromRuntime}/${entry.name}`
        : entry.name
      const fullPathFs = `${context.runtimeDirFsPath}/${relativeFromRuntime}`.replace(/\/+/g, '/')

      if (entry.isDirectory) {
        await walkRuntime(fullPathFs, relativeFromRuntime)
        continue
      }

      if (!entry.isFile) {
        continue
      }

      await moveOutputFile(fullPathFs, relativeFromRuntime)
    }
  }

  await walkRuntime(context.runtimeDirFsPath)

  const existingOutputEntries = context.fsBaseDir
    ? await readDir(context.outputDirFsPath, { baseDir: context.fsBaseDir })
    : await readDir(context.outputDirFsPath)

  for (const entry of existingOutputEntries) {
    if (entry.isFile && entry.name && isOutputLikeFile(entry.name) && !isScriptLikeFile(entry.name)) {
      const outputRelativePath = `outputs/${context.skillId}/${entry.name}`
      if (!seenTargets.has(outputRelativePath) && !previousOutputs.has(outputRelativePath)) {
        movedFiles.push(outputRelativePath)
      }
    }
  }

  return Array.from(new Set(movedFiles))
}

export async function executeSkillRuntime(
  request: SkillExecutionRequest
): Promise<SkillExecutionOutcome> {
  const startTime = Date.now()
  const executionTimeout = Math.min(Math.max(request.timeout || 60000, 1000), 300000)

  const context = await resolveContext(request.skillId)
  const parsed = parseCommand(request.command, Array.isArray(request.args) ? request.args : [])
  const normalizedPlan = await normalizeExecutionPlan(parsed.cmd, parsed.cmdArgs)
  const normalizedCommand = normalizedPlan.command
  const processedArgs: string[] = []
  const existingOutputs = await snapshotOutputFiles(context)

  for (const arg of normalizedPlan.args) {
    processedArgs.push(await normalizeArg(arg, context))
  }

  const envPrefix = [
    `SKILL_OUTPUT_DIR="${context.outputDir}"`,
    `SKILL_RUNTIME_DIR="${context.runtimeDir}"`,
    `SKILL_ROOT_DIR="${context.skillDir}"`,
    `NOTEGEN_OUTPUT_DIR="${context.outputDir}"`,
  ].join(' ')
  const workingDirectory = determineWorkingDirectory(context, normalizedCommand, processedArgs)

  const shellCommand = parsed.cmd === 'bash' && processedArgs[0] === '-c'
    ? `cd "${workingDirectory}" && ${envPrefix} ${processedArgs.slice(1).join(' ')}`
    : `cd "${workingDirectory}" && ${envPrefix} ${buildShellCommand(workingDirectory, workingDirectory, normalizedCommand, processedArgs).replace(`cd "${workingDirectory}" && `, '')}`

  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []

  async function runShellCommand(): Promise<{ code: number; stdout: string; stderr: string }> {
    const process = Command.create('bash', ['-c', shellCommand])

    process.stdout.on('data', (line: string) => {
      stdoutChunks.push(line)
    })

    process.stderr.on('data', (line: string) => {
      stderrChunks.push(line)
    })

    const execution = process.execute()
    const result = await Promise.race([
      execution,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Script execution timed out after ${executionTimeout}ms`)), executionTimeout)
      ),
    ])

    return {
      code: result.code ?? -1,
      stdout: stdoutChunks.join('') + (result.stdout || ''),
      stderr: stderrChunks.join('') + (result.stderr || ''),
    }
  }

  try {
    let result = await runShellCommand()
    let installedDependency: string | undefined

    if (result.code !== 0) {
      const installResult = await ensureDependencyForCommand({
        stderr: result.stderr,
        command: normalizedCommand,
        workingDirectory: context.skillDir,
      })

      if (installResult?.success) {
        installedDependency = installResult.installed
        stdoutChunks.length = 0
        stderrChunks.length = 0
        result = await runShellCommand()
      }
    }

    const outputFiles = result.code === 0 ? await collectGeneratedOutputs(context, existingOutputs) : []
    const executionTime = Date.now() - startTime

    return {
      success: result.code === 0,
      error: result.code === 0 ? undefined : (result.stderr || `命令执行失败，退出码: ${result.code}`),
      data: {
        exit_code: result.code,
        execution_time_ms: executionTime,
        working_directory: workingDirectory,
        runtime_directory: context.runtimeDir,
        output_directory: context.outputDir,
        stdout: result.stdout,
        stderr: result.stderr,
        dependency_installed: installedDependency,
        output_files: outputFiles,
      },
      message: result.code === 0
        ? `Command executed successfully (exit code: ${result.code}, time: ${executionTime}ms).${installedDependency ? `\n\nAuto-installed dependency: ${installedDependency}` : ''}${outputFiles.length > 0 ? `\n\nOutput files:\n${outputFiles.map(file => `- ${file}`).join('\n')}` : ''}\n\nOutput:\n${result.stdout || '(no output)'}`
        : `Command failed with exit code ${result.code} (time: ${executionTime}ms).${installedDependency ? `\n\nAuto-installed dependency: ${installedDependency}` : ''}\n\n${result.stderr ? `Error:\n${result.stderr}` : 'No error message'}${result.stdout ? `\n\nOutput:\n${result.stdout}` : ''}`,
    }
  } catch (error) {
    const executionTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      error: `Script execution error: ${errorMessage}`,
      message: `Script execution failed: ${errorMessage}`,
      data: {
        exit_code: -1,
        execution_time_ms: executionTime,
        working_directory: workingDirectory,
        runtime_directory: context.runtimeDir,
        output_directory: context.outputDir,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        timeout: errorMessage.includes('timed out'),
      },
    }
  }
}
