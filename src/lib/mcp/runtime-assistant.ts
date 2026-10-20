import { invoke } from '@tauri-apps/api/core'

export type MCPRuntimeKind =
  | 'npx'
  | 'uvx'
  | 'python'
  | 'python3'
  | 'bunx'
  | 'unknown'

export interface MCPInstallRecipe {
  id: string
  title: string
  commandPreview: string
  postInstallHint?: string | null
  scope: string
  manualOnly: boolean
}

export interface MCPRuntimeCheckResult {
  command: string
  installed: boolean
  resolvedPath?: string | null
  version?: string | null
  error?: string | null
}

export interface MCPRuntimeInspection {
  launcher: string
  kind: MCPRuntimeKind
  checks: MCPRuntimeCheckResult[]
  installRecipe?: MCPInstallRecipe | null
}

export interface MCPRuntimeInstallResult {
  recipeId: string
  success: boolean
  stdout: string
  stderr: string
  exitCode?: number | null
}

export interface MCPCancelInstallResult {
  recipeId: string
  cancelled: boolean
}

export type MCPInstallProgressStage =
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'completed'
  | 'failed'

export interface MCPInstallProgressEvent {
  recipeId: string
  stage: MCPInstallProgressStage
  stream?: string | null
  line?: string | null
  exitCode?: number | null
}

export async function inspectMcpRuntime(command: string, args: string[] = []): Promise<MCPRuntimeInspection> {
  return invoke<MCPRuntimeInspection>('inspect_mcp_runtime', { command, args })
}

export async function installMcpRuntime(recipeId: string): Promise<MCPRuntimeInstallResult> {
  return invoke<MCPRuntimeInstallResult>('install_mcp_runtime', { recipeId })
}

export async function cancelMcpRuntimeInstall(recipeId: string): Promise<MCPCancelInstallResult> {
  return invoke<MCPCancelInstallResult>('cancel_mcp_runtime_install', { recipeId })
}
