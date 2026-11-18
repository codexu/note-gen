import { agentTaskCenter, discardTaskDrafts } from '@/lib/agent-tasks'
import { isUiV3 } from '@/lib/fork-ui'
import { beginLocalMcpWorkspaceWrite } from '@/lib/local-mcp/workspace-guard'
import useArticleStore from '@/stores/article'
import { readingKey, useEditorReadingStore } from '@/stores/editor-reading'
import useDailySettingsStore from '@/stores/daily-settings'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'
import { eligible, referencedPaths, VAULT_LIMIT } from './detect'
import { ORGANIZE_KIND, planOf } from './drafts'
import { readOrganizeRecord, saveOrganizeRecord } from './history'
import { applyChanges, OrganizeConflict, undoChanges, type OrganizeIO } from './transaction'
import { currentWorkspaceIdentity, inspectNote, readOrganizeNote, replaceOrganizeNote } from './vault-io'

let reviewing = false

async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (reviewing || !isUiV3()) throw new OrganizeConflict()
  reviewing = true
  const release = beginLocalMcpWorkspaceWrite()
  try { return await action() }
  finally {
    release()
    reviewing = false
  }
}

async function prepareEditor(paths: string[]) {
  const { workspacePath } = useSettingStore.getState()
  const { readOnlyFiles } = useEditorReadingStore.getState()
  for (const path of paths) {
    if (readOnlyFiles[readingKey(workspacePath, path)]) throw new OrganizeConflict()
    await useArticleStore.getState().flushPendingArticleSave(path)
  }
}

function ioFor(identity: string): OrganizeIO {
  return {
    read: path => readOrganizeNote(path, identity),
    replace: (path, before, after) => replaceOrganizeNote(path, identity, before, after),
    save: saveOrganizeRecord,
  }
}

export async function acceptOrganizeDraft(taskId: string, draftId: string): Promise<() => Promise<boolean>> {
  await exclusive(async () => {
    const task = agentTaskCenter.get(taskId)
    const draft = task?.drafts.find(item => item.id === draftId)
    const args = draft && planOf(draft)
    if (task?.kind !== ORGANIZE_KIND || draft?.state !== 'pending' || !args
      || useSettingStore.getState().workspacePath !== args.workspace
      || await currentWorkspaceIdentity() !== args.workspaceIdentity) throw new OrganizeConflict()

    const { plan, workspaceIdentity } = args
    const io = ioFor(workspaceIdentity)
    const previous = await readOrganizeRecord(draftId)
    if (previous?.status === 'prepared') throw new OrganizeConflict()
    if (!previous) {
      try {
        const paths = Object.keys(plan.mtimes)
        await prepareEditor(paths)
        await useDailySettingsStore.getState().initSettings()
        const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
        const index = useVaultIndexStore.getState()
        if (index.status !== 'ready' || index.notes.size > VAULT_LIMIT
          || (plan.kind === 'merge' && referencedPaths(index.notes)(plan.detail))) throw new OrganizeConflict()
        for (const path of paths) {
          const info = await inspectNote(path, workspaceIdentity)
          if (!info || info.mtime !== plan.mtimes[path]
            || !eligible({ path, mtime: info.mtime }, Date.now(), dailyFolder, dailyPattern)) throw new OrganizeConflict()
        }
        if (!isUiV3()) throw new OrganizeConflict()
        await applyChanges({
          id: draftId, workspace: workspaceIdentity, title: draft.summary, changes: plan.changes, status: 'prepared',
        }, io)
      } catch (error) {
        const saved = await readOrganizeRecord(draftId)
        // Only an interrupted/partially applied record belongs in the recovery UI.
        if (error instanceof OrganizeConflict && saved?.status !== 'prepared') await discardTaskDrafts(taskId, [draftId])
        throw error
      }
    } else if (previous.status === 'reverted') {
      await discardTaskDrafts(taskId, [draftId])
      throw new OrganizeConflict()
    }

    // The journal remains authoritative if persisting the reviewed status fails.
    const latest = agentTaskCenter.get(taskId) ?? task
    await agentTaskCenter.updateDrafts(taskId, latest.drafts.map(item =>
      item.id === draftId ? { ...item, state: 'applied' } : item))
  })
  return () => undoOrganizeChange(draftId)
}

export async function rejectOrganizeDraft(taskId: string, draftId: string): Promise<void> {
  await exclusive(async () => {
    const draft = agentTaskCenter.get(taskId)?.drafts.find(item => item.id === draftId)
    const args = draft && planOf(draft)
    if (!args || draft.state !== 'pending' || await currentWorkspaceIdentity() !== args.workspaceIdentity) throw new OrganizeConflict()
    await discardTaskDrafts(taskId, [draftId])
  })
}

export async function undoOrganizeChange(id: string): Promise<boolean> {
  try {
    await exclusive(async () => {
      const record = await readOrganizeRecord(id)
      if (!record || await currentWorkspaceIdentity() !== record.workspace) throw new OrganizeConflict()
      await prepareEditor(record.changes.map(change => change.path))
      await undoChanges(record, ioFor(record.workspace))
    })
    return true
  } catch {
    return false
  }
}
