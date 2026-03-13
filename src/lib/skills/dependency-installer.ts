/**
 * Dependency Installer for Skills
 *
 * Automatically detects missing dependencies from error messages and installs them.
 */

import { Command } from '@tauri-apps/plugin-shell'
import { writeTextFile, exists } from '@tauri-apps/plugin-fs'

/**
 * Parsed dependency information
 */
export interface DependencyInfo {
  type: 'python' | 'node' | 'unknown'
  moduleName: string
  installCommand: string
  installArgs: string[]
}

/**
 * Dependency installation result
 */
export interface InstallResult {
  success: boolean
  message: string
  installed?: string
  alreadyInstalled?: boolean
}

export interface DependencyInstallRequest {
  stderr: string
  command: string
  workingDirectory: string
}

/**
 * Module to package name mapping
 * Handles cases where module name differs from package name
 */
const MODULE_TO_PACKAGE: Record<string, { python?: string; node?: string }> = {
  // Python modules
  'pptx': { python: 'python-pptx' },
  'PIL': { python: 'Pillow' },
  'PIL.Image': { python: 'Pillow' },
  'markitdown': { python: 'markitdown[pptx]' },
  'openai': { python: 'openai', node: 'openai' },
  'anthropic': { python: 'anthropic' },
  'numpy': { python: 'numpy' },
  'pandas': { python: 'pandas' },
  'matplotlib': { python: 'matplotlib' },
  'requests': { python: 'requests' },

  // Node modules
  'pptxgenjs': { node: 'pptxgenjs' },
  '@anthropic-ai/sdk': { node: '@anthropic-ai/sdk' },
}

/**
 * Parse error message to extract missing dependency
 */
export function parseDependencyError(stderr: string): DependencyInfo | null {
  if (!stderr) return null

  const lines = stderr.split('\n')
  const errorLine = lines.find(l =>
    l.includes('ModuleNotFoundError') ||
    l.includes('No module named') ||
    l.includes('Cannot find module') ||
    l.includes("Cannot find package")
  )

  if (!errorLine) return null

  // Python: ModuleNotFoundError: No module named 'pptx'
  const pythonMatch = errorLine.match(/No module named ['"]([^'"]+)['"]/) ||
                     errorLine.match(/ModuleNotFoundError.*['"]([^'"]+)['"]/)

  if (pythonMatch) {
    const moduleName = pythonMatch[1]
    const packageName = MODULE_TO_PACKAGE[moduleName]?.python || moduleName

    return {
      type: 'python',
      moduleName,
      installCommand: 'pip',
      installArgs: ['install', packageName],
    }
  }

  // Node: Error: Cannot find module 'pptxgenjs'
  const nodeMatch = errorLine.match(/Cannot find module ['"]([^'"]+)['"]/) ||
                   errorLine.match(/Cannot find package ['"]([^'"]+)['"]/)

  if (nodeMatch) {
    const moduleName = nodeMatch[1]

    // 如果匹配到的是路径而非模块名（如包含 / 或 .js 后缀），跳过
    if (moduleName.includes('/') || moduleName.includes('\\') || moduleName.endsWith('.js')) {
      return null
    }

    // 过滤有效的模块名（只能包含字母、数字、@、-、_）
    if (!/^[a-zA-Z0-9@_-]+$/.test(moduleName)) {
      return null
    }

    const packageName = MODULE_TO_PACKAGE[moduleName]?.node || moduleName

    return {
      type: 'node',
      moduleName,
      installCommand: 'npm',
      installArgs: ['install', '-g', packageName],
    }
  }

  return null
}

/**
 * Check if a command exists (for fallback to pip3, npm, etc.)
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await Command.create('bash', ['-c', `command -v "${cmd}"`]).execute()
    return result.code === 0
  } catch {
    return false
  }
}

async function detectNodePackageManager(workingDirectory: string): Promise<'pnpm' | 'npm' | 'yarn' | null> {
  const candidates: Array<{ lockFile: string; command: 'pnpm' | 'npm' | 'yarn' }> = [
    { lockFile: 'pnpm-lock.yaml', command: 'pnpm' },
    { lockFile: 'package-lock.json', command: 'npm' },
    { lockFile: 'yarn.lock', command: 'yarn' },
  ]

  for (const candidate of candidates) {
    if (await exists(`${workingDirectory}/${candidate.lockFile}`) && await commandExists(candidate.command)) {
      return candidate.command
    }
  }

  for (const command of ['pnpm', 'npm', 'yarn'] as const) {
    if (await commandExists(command)) {
      return command
    }
  }

  return null
}

export async function detectPythonCommand(preferred: string): Promise<string | null> {
  if (await commandExists(preferred)) {
    return preferred
  }

  for (const command of ['python3', 'python'] as const) {
    if (await commandExists(command)) {
      return command
    }
  }

  return null
}

/**
 * Install a dependency
 * @param dep - Dependency info
 * @param targetDir - Optional target directory for installation (e.g., appDataPath for node_modules)
 */
export async function installDependency(dep: DependencyInfo, targetDir?: string): Promise<InstallResult> {
  const { installCommand, installArgs, moduleName, type } = dep

  try {
    // For Node.js modules, if targetDir is provided, install locally there
    if (type === 'node' && targetDir) {
      // Check if package.json exists, if not create one
      const packageJsonPath = `${targetDir}/package.json`
      const hasPackageJson = await exists(packageJsonPath)

      if (!hasPackageJson) {
        // Create a minimal package.json
        await writeTextFile(packageJsonPath, JSON.stringify({
          name: 'note-gen-skills',
          version: '1.0.0',
          description: 'Dependencies for NoteGen skills',
          private: true
        }, null, 2))
      }

      // Install in target directory
      const installCmd = `cd "${targetDir}" && npm install ${moduleName}`

      const result = await Command.create('bash', ['-c', installCmd]).execute()

      if (result.code === 0) {
        return {
          success: true,
          message: `Successfully installed node module '${moduleName}' in ${targetDir}`,
          installed: moduleName,
        }
      } else {
        return {
          success: false,
          message: `Failed to install node module '${moduleName}': ${result.stderr || 'Unknown error'}`,
        }
      }
    }

    // Try with fallback commands (e.g., pip -> pip3, python -> python3)
    const fallbacks = {
      pip: ['pip3'],
      python: ['python3'],
      npm: [], // npm usually doesn't have a fallback
    }

    const possibleCommands = [installCommand, ...(fallbacks[installCommand as keyof typeof fallbacks] || [])]

    for (const cmd of possibleCommands) {
      // Check if command exists
      if (!(await commandExists(cmd))) {
        continue
      }

      const args = installArgs.map(a => a.replace(installCommand, cmd))
      const shellCommand = `${cmd} ${args.join(' ')}`

      const result = await Command.create('bash', ['-c', shellCommand]).execute()

      if (result.code === 0) {
        return {
          success: true,
          message: `Successfully installed ${type} module '${moduleName}' using ${shellCommand}`,
          installed: moduleName,
        }
      }
    }

    return {
      success: false,
      message: `Failed to install ${type} module '${moduleName}'. Tried commands: ${possibleCommands.join(', ')}. Please install manually.`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      message: `Error installing ${type} module '${moduleName}': ${errorMessage}`,
    }
  }
}

/**
 * Parse error and install dependency if applicable
 * Returns null if error is not a dependency error
 * @param stderr - Error message from command execution
 * @param targetDir - Optional target directory for dependency installation
 */
export async function handleDependencyError(stderr: string, targetDir?: string): Promise<InstallResult | null> {
  const dep = parseDependencyError(stderr)

  if (!dep) {
    return null
  }

  return await installDependency(dep, targetDir)
}

export async function ensureDependencyForCommand(
  request: DependencyInstallRequest
): Promise<InstallResult | null> {
  const dep = parseDependencyError(request.stderr)

  if (!dep) {
    return null
  }

  if (dep.type === 'python') {
    const pythonCommand = await detectPythonCommand(request.command.startsWith('python') ? request.command : 'python3')
    if (!pythonCommand) {
      return {
        success: false,
        message: `Python interpreter not found. Missing module: ${dep.moduleName}`,
      }
    }

    const packageName = dep.installArgs[1]
    const shellCommand = `cd "${request.workingDirectory}" && ${pythonCommand} -m pip install ${packageName}`
    const result = await Command.create('bash', ['-c', shellCommand]).execute()

    return result.code === 0
      ? {
          success: true,
          message: `Successfully installed python module '${packageName}'`,
          installed: packageName,
        }
      : {
          success: false,
          message: result.stderr || `Failed to install python module '${packageName}'`,
        }
  }

  if (dep.type === 'node') {
    const packageManager = await detectNodePackageManager(request.workingDirectory)
    if (!packageManager) {
      return {
        success: false,
        message: `No available Node package manager found. Missing module: ${dep.moduleName}`,
      }
    }

    const packageName = dep.installArgs[dep.installArgs.length - 1]
    const installCommands: Record<'pnpm' | 'npm' | 'yarn', string> = {
      pnpm: `cd "${request.workingDirectory}" && pnpm add ${packageName}`,
      npm: `cd "${request.workingDirectory}" && npm install ${packageName}`,
      yarn: `cd "${request.workingDirectory}" && yarn add ${packageName}`,
    }

    const result = await Command.create('bash', ['-c', installCommands[packageManager]]).execute()

    return result.code === 0
      ? {
          success: true,
          message: `Successfully installed node module '${packageName}' using ${packageManager}`,
          installed: packageName,
        }
      : {
          success: false,
          message: result.stderr || `Failed to install node module '${packageName}' using ${packageManager}`,
        }
  }

  return null
}
