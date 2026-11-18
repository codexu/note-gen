import type { DraftChange } from '@/lib/agent-tasks/types'
import type { OrganizePlan } from './detect'

export const ORGANIZE_KIND = 'organize'
export const ORGANIZE_TOOL = 'organize_review'

interface OrganizeDraftArgs extends Record<string, unknown> {
  workspace: string
  workspaceIdentity: string
  plan: OrganizePlan
}

export type OrganizeDraft = DraftChange & { args: OrganizeDraftArgs }

export function isOrganizeDraft(draft: Pick<DraftChange, 'toolName'>): boolean {
  return draft.toolName === ORGANIZE_TOOL
}

export function planOf(draft: DraftChange): OrganizeDraftArgs | undefined {
  if (!isOrganizeDraft(draft)) return
  return draft.args as OrganizeDraftArgs
}

export function buildOrganizeDraft(plan: OrganizePlan, workspace: string, workspaceIdentity: string, summary: string): OrganizeDraft {
  const update = plan.changes.find(change => change.path === plan.path)
  const primary = update ?? plan.changes[0]
  return {
    id: crypto.randomUUID(),
    toolName: ORGANIZE_TOOL,
    args: { workspace, workspaceIdentity, plan },
    kind: update ? 'update' : 'delete',
    path: primary.path,
    targetPath: plan.kind === 'merge' && !update ? plan.path : undefined,
    baseContent: primary.before,
    content: update?.after ?? undefined,
    summary,
    state: 'pending',
  }
}
