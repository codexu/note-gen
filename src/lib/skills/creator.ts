import { invoke } from '@tauri-apps/api/core'
import { getWorkspacePath } from '@/lib/workspace'
import type { SkillScope } from './types'

export const BUILTIN_SKILL_CREATOR = {
  id: 'notegen-skill-creator',
  name: 'notegen-skill-creator',
  description: 'Create, install, or update reusable Agent Skills inside NoteGen. Use when the user asks to create a Skill, build a reusable AI workflow, install the created Skill, or modify an existing Skill.',
  instructions: `# Create or update a NoteGen Skill

Create a complete, reusable Agent Skill from the user's natural-language requirements and install it when requested.

## Workflow

1. Understand the intended workflow through concrete trigger examples. Ask at most one necessary question at a time, and skip clarification when the request is already specific.
2. Inspect installed Skills before choosing a name or updating an existing Skill. Use short verb-led kebab-case names under 64 characters.
3. Keep SKILL.md concise. Put detailed domain material in references/, deterministic repeated logic in scripts/, and output templates in assets/. Do not add README, installation, changelog, or other process documentation.
4. Write a description that says both what the Skill does and when it should trigger. Put all trigger guidance in the description.
5. Prefer NoteGen tools and instruction-only Skills. Add scripts only when deterministic execution is genuinely required.
6. Call skill_validate_package with the complete package. Fix every validation error before installation.
7. Call skill_install_package only after validation succeeds. Use project scope for workspace-specific knowledge and global scope for reusable personal workflows. Set replaceExisting only when the user explicitly asks to update an existing Skill. Updates preserve existing resources unless their exact paths are listed in removeFiles.
8. After installation, report the installed name, scope, resources, and whether executable scripts were added.

## Package rules

- SKILL.md is generated from name, description, and instructions; do not include it in files.
- Additional text files must live below scripts/, references/, assets/, or agents/.
- Reference every supporting file from SKILL.md and state when it should be read or run.
- Script installation does not authorize execution. Script execution and dependency installation remain separately permissioned.
`,
} as const

export interface SkillPackageResource {
  path: string
  content: string
}

export interface SkillPackageInput {
  name: string
  description: string
  instructions: string
  files?: SkillPackageResource[]
  removeFiles?: string[]
  scope: SkillScope
  replaceExisting?: boolean
}

export interface SkillPackageValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  fileCount: number
  totalBytes: number
  hasScripts: boolean
  replacing: boolean
}

export interface SkillPackageInstallResult {
  name: string
  scope: SkillScope
  replaced: boolean
  fileCount: number
  hasScripts: boolean
}

async function buildRequest(input: SkillPackageInput) {
  const workspace = input.scope === 'project' ? await getWorkspacePath() : null
  return {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    files: input.files ?? [],
    removeFiles: input.removeFiles ?? [],
    scope: input.scope,
    workspaceRoot: workspace?.isCustom ? workspace.path : null,
    replaceExisting: input.replaceExisting ?? false,
  }
}

export async function validateSkillPackage(
  input: SkillPackageInput
): Promise<SkillPackageValidation> {
  return await invoke<SkillPackageValidation>('validate_skill_package', {
    request: await buildRequest(input),
  })
}

export async function installSkillPackage(
  input: SkillPackageInput
): Promise<SkillPackageInstallResult> {
  return await invoke<SkillPackageInstallResult>('install_skill_package', {
    request: await buildRequest(input),
  })
}
