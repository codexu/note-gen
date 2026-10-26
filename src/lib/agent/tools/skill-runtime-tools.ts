import { copyFile, exists, lstat, mkdir } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { resolveAttachmentChildPath, type RuntimeChatAttachment } from '@/lib/chat-attachments'
import { skillManager } from '@/lib/skills'
import {
  executeSkillCode,
  getSkillRuntimeContext,
  getSkillWorkspaceIdentity,
  inspectSkillEnvironment,
  installSkillNodeDependencies,
  type SkillCodeLanguage,
} from '@/lib/skills/runtime'
import { ensureSafeWorkspaceRelativePath, getWorkspacePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import type { AgentTool, AgentToolResult } from '../types'

const MAX_INPUT_FILES = 20
const NODE_PACKAGE_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)?$/

function skillIdFrom(input: Record<string, unknown>): string {
  const id = typeof input.skill_id === 'string' ? input.skill_id : ''
  const skill = skillManager.getSkill(id)
  if (!skill || skill.metadata.enabled === false) throw new Error('The Skill must be installed, enabled, and loaded in this task')
  return id
}

function errorResult(error: unknown, code: string): AgentToolResult {
  return { ok: false, message: error instanceof Error ? error.message : String(error), error: code }
}

async function refreshOutputFiles(paths: string[], workspaceIdentity: string): Promise<void> {
  if (!paths.length) return
  if (getSkillWorkspaceIdentity(await getWorkspacePath()) !== workspaceIdentity) return
  const store = useArticleStore.getState()
  let inserted = false
  for (const path of paths) {
    if (getSkillWorkspaceIdentity(await getWorkspacePath()) !== workspaceIdentity) return
    inserted = store.insertLocalEntry(path, false) || inserted
    await store.ensurePathExpanded(path)
  }
  if (!inserted) await store.loadFileTree()
}

export const runSkillCodeTool: AgentTool = {
  name: 'skill_run_code',
  title: '运行 Skill 任务代码',
  description: 'Run task-specific Python, JavaScript, or Bash source required by a loaded Skill, including official inline examples. Every invocation requires approval of this exact source, language, and arguments. Source is saved under the isolated runtime/generated directory; installed Skill files remain read-only. Use SKILL_ROOT_DIR to read package resources, SKILL_RUNTIME_DIR for scratch files, and SKILL_OUTPUT_DIR for final artifacts. The working directory is a unique outputs/<skill_id>/runs/<execution_id> directory. Prepare original attachment/workspace inputs with skill_prepare_inputs first. Never use this tool in read-only mode.',
  category: 'skill',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'Exact Skill ID previously loaded with skill_load.' },
      language: { type: 'string', enum: ['python', 'javascript', 'bash'] },
      code: { type: 'string', description: 'Complete source code to run, shown verbatim for this invocation’s approval. Maximum 128 KiB of UTF-8.' },
      args: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Exact data arguments for this invocation. Do not include an interpreter or script path.' },
      timeout: { type: 'number', minimum: 1000, maximum: 300000, description: 'Timeout in milliseconds; defaults to 60000.' },
    },
    required: ['skill_id', 'language', 'code'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    try {
      const skillId = skillIdFrom(input)
      const workspaceIdentity = context.workspaceIdentity ?? getSkillWorkspaceIdentity(await getWorkspacePath())
      if (!['python', 'javascript', 'bash'].includes(String(input.language)) || typeof input.code !== 'string') {
        throw new Error('A supported language and complete source code are required')
      }
      if (input.args !== undefined && (!Array.isArray(input.args) || !input.args.every(arg => typeof arg === 'string'))) {
        throw new Error('args must contain only strings')
      }
      const outcome = await executeSkillCode({
        skillId,
        language: input.language as SkillCodeLanguage,
        code: input.code,
        args: input.args as string[] | undefined,
        timeout: typeof input.timeout === 'number' ? input.timeout : undefined,
        signal: context.signal,
        expectedWorkspaceIdentity: workspaceIdentity,
      })
      try {
        await refreshOutputFiles([
          ...(outcome.data.output_files || []),
          ...(outcome.data.partial_output_files || []),
        ], workspaceIdentity)
      } catch (error) {
        console.error('[skill_run_code] Failed to refresh output files', error)
      }
      return { ok: outcome.success, message: outcome.message, error: outcome.error, data: outcome.data }
    } catch (error) {
      return errorResult(error, 'SKILL_CODE_EXECUTION_FAILED')
    }
  },
}

export const installSkillNodeDependenciesTool: AgentTool = {
  name: 'skill_install_node_dependencies',
  title: '安装 Skill Node 依赖',
  description: 'Install explicitly named npm registry packages into a loaded Skill’s isolated runtime. Use package names or exact semver specs, such as docx or docx@9.5.1. URLs, local paths, flags, tags, and version ranges are rejected. Every invocation requires separate approval of the exact package list. This does not change the installed Skill package.',
  category: 'skill',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'Exact loaded Skill ID.' },
      packages: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Exact npm registry package specs to approve and install.' },
    },
    required: ['skill_id', 'packages'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    try {
      const skillId = skillIdFrom(input)
      if (!Array.isArray(input.packages) || !input.packages.length || input.packages.length > 20
        || !input.packages.every((value): value is string => typeof value === 'string' && value.length <= 200 && NODE_PACKAGE_SPEC.test(value))) {
        throw new Error('packages must contain 1–20 npm registry package names or exact semver specs')
      }
      const result = await installSkillNodeDependencies(skillId, input.packages, context.signal, undefined, context.workspaceIdentity)
      return { ok: true, message: `Installed Node dependencies for Skill "${skillId}": ${result.packages.join(', ')}.`, data: result }
    } catch (error) {
      return errorResult(error, 'SKILL_NODE_DEPENDENCY_INSTALL_FAILED')
    }
  },
}

export const inspectSkillEnvironmentTool: AgentTool = {
  name: 'skill_inspect_environment',
  title: '查看 Skill 运行环境',
  description: 'Inspect Python, Node.js, npm, and the supported document command dependencies for a loaded Skill. Returns actual availability and paths for pandoc, soffice, pdftoppm, pdftotext, qpdf, and tesseract. Reads status only; does not install anything.',
  category: 'skill',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: { skill_id: { type: 'string', description: 'Exact loaded Skill ID.' } },
    required: ['skill_id'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    try {
      const skillId = skillIdFrom(input)
      const environment = await inspectSkillEnvironment(skillId, undefined, context.workspaceIdentity)
      return { ok: true, message: 'Inspected the Skill execution environment. Use only available runtimes and commands; install missing Python/npm packages only with explicit approval.', data: environment }
    } catch (error) {
      return errorResult(error, 'SKILL_ENVIRONMENT_INSPECTION_FAILED')
    }
  },
}

function cleanRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('A workspace-relative file path is required')
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Absolute paths and path traversal are not allowed')
  }
  return path
}

async function createInputDirectory(runtimeDir: string, runId: string): Promise<string> {
  const appRoot = (await appDataDir()).replace(/\\/g, '/').replace(/\/+$/, '')
  const directory = `${runtimeDir}/inputs/${runId}/${crypto.randomUUID()}`
  if (!directory.startsWith(`${appRoot}/skill-runtimes/`)) throw new Error('Invalid isolated Skill runtime directory')
  let current = appRoot
  for (const segment of directory.slice(appRoot.length + 1).split('/')) {
    current = `${current}/${segment}`
    if (!(await exists(current))) await mkdir(current)
    const info = await lstat(current)
    if (!info.isDirectory || info.isSymlink) throw new Error('Skill input staging cannot traverse symbolic links')
  }
  return directory
}

export const prepareSkillInputsTool: AgentTool = {
  name: 'skill_prepare_inputs',
  title: '准备 Skill 原始文件',
  description: 'Copy original binary or text inputs into a loaded Skill’s isolated runtime/inputs/<run_id> directory without changing the originals. Attachments must use IDs from this task’s attachment context; folder attachments require an exact relative file path. Workspace paths must be normalized relative paths. Returns absolute staged file paths for Python/JavaScript/Bash and registered scripts; use this instead of recreating attachments from summaries. Does not copy folders or follow symbolic links.',
  category: 'skill',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', description: 'Exact loaded Skill ID.' },
      attachments: {
        type: 'array', maxItems: MAX_INPUT_FILES,
        items: {
          type: 'object',
          properties: {
            attachmentId: { type: 'string', description: 'ID from this task’s current attachment context.' },
            relativePath: { type: 'string', description: 'Required for a file inside a folder attachment; omit for a file attachment.' },
          },
          required: ['attachmentId'], additionalProperties: false,
        },
      },
      workspacePaths: { type: 'array', items: { type: 'string' }, maxItems: MAX_INPUT_FILES, description: 'Normalized paths relative to the current workspace, never absolute paths.' },
    },
    required: ['skill_id'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    try {
      const skillId = skillIdFrom(input)
      const runtime = await getSkillRuntimeContext(skillId, undefined, true, context.workspaceIdentity)
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(context.runId)) throw new Error('Invalid task runtime ID')
      if (input.attachments !== undefined && !Array.isArray(input.attachments)) throw new Error('attachments must be an array')
      if (input.workspacePaths !== undefined && !Array.isArray(input.workspacePaths)) throw new Error('workspacePaths must be an array')
      const attachmentRequests = Array.isArray(input.attachments) ? input.attachments : []
      const workspaceRequests = Array.isArray(input.workspacePaths) ? input.workspacePaths : []
      if (!attachmentRequests.length && !workspaceRequests.length) throw new Error('Choose at least one current attachment or workspace file')
      if (attachmentRequests.length + workspaceRequests.length > MAX_INPUT_FILES) throw new Error(`At most ${MAX_INPUT_FILES} input files may be prepared per call`)
      const plans: Array<{ source: string; name: string; attachmentId?: string; relativePath?: string }> = []
      for (const value of attachmentRequests) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid attachment input')
        const request = value as Record<string, unknown>
        const attachment = context.context.attachments?.find(item => item.id === request.attachmentId)
        if (!attachment) throw new Error('The attachment is no longer available in this task')
        if ((await lstat(attachment.path)).isSymlink) throw new Error('Symbolic-link attachments are not supported')
        const relativePath = attachment.kind === 'folder' ? cleanRelativePath(request.relativePath) : ''
        if (attachment.kind === 'file' && request.relativePath) throw new Error('File attachments cannot have a relative child path')
        const source = await resolveAttachmentChildPath(attachment, relativePath)
        plans.push({ source, name: source.replace(/\\/g, '/').split('/').pop() || attachment.name, attachmentId: attachment.id, relativePath })
      }
      const workspaceAttachment: RuntimeChatAttachment = { id: 'workspace', kind: 'folder', name: 'workspace', readable: true, path: runtime.appArticleDir }
      for (const value of workspaceRequests) {
        const relativePath = await ensureSafeWorkspaceRelativePath(cleanRelativePath(value))
        const source = await resolveAttachmentChildPath(workspaceAttachment, relativePath)
        plans.push({ source, name: relativePath.split('/').pop() || relativePath, relativePath })
      }
      for (const plan of plans) {
        const info = await lstat(plan.source)
        if (!info.isFile || info.isSymlink) throw new Error('Skill inputs must be regular files; folders and symbolic links are not copied')
      }
      context.signal?.throwIfAborted()
      const inputDirectory = await createInputDirectory(runtime.runtimeDir, context.runId)
      const files: Array<{ path: string; name: string; attachmentId?: string; relativePath?: string }> = []
      for (const [index, plan] of plans.entries()) {
        context.signal?.throwIfAborted()
        const path = `${inputDirectory}/${index + 1}-${plan.name}`
        await copyFile(plan.source, path)
        files.push({ path, name: plan.name, attachmentId: plan.attachmentId, relativePath: plan.relativePath })
      }
      return { ok: true, message: `Prepared ${files.length} original input file(s). Originals are unchanged; pass the returned paths to Skill scripts or task code.`, data: { skill_id: skillId, input_directory: inputDirectory, files } }
    } catch (error) {
      return errorResult(error, 'SKILL_INPUT_PREPARATION_FAILED')
    }
  },
}

export const skillRuntimeTools = [runSkillCodeTool, installSkillNodeDependenciesTool, inspectSkillEnvironmentTool, prepareSkillInputsTool]
