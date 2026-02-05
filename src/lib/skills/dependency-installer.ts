/**
 * Dependency Installer for Skills
 *
 * Automatically detects missing dependencies from error messages and installs them.
 */

import { Command } from '@tauri-apps/plugin-shell'

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
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await Command.create('bash', ['-c', `command -v "${cmd}"`]).execute()
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Install a dependency
 */
export async function installDependency(dep: DependencyInfo): Promise<InstallResult> {
  const { installCommand, installArgs, moduleName, type } = dep

  try {
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
 */
export async function handleDependencyError(stderr: string): Promise<InstallResult | null> {
  const dep = parseDependencyError(stderr)

  if (!dep) {
    return null
  }

  return await installDependency(dep)
}
