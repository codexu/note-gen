import { agentTaskCenter, startAgentTaskCenter } from '@/lib/agent-tasks'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore from '@/stores/vault-index'
import useSettingStore from '@/stores/setting'
import { getWorkspaceAbsolutePath } from '@/lib/workspace'
import { detectProposals, eligible, NOTE_BYTES_LIMIT, PROPOSAL_LIMIT, READ_LIMIT, VAULT_LIMIT, type OrganizePlan } from './detect'
import { buildOrganizeDraft, ORGANIZE_KIND, planOf } from './drafts'
import { currentWorkspaceIdentity, inspectNote, readOrganizeNote } from './vault-io'

const cursors = new Map<string, number>()
const READ_CONCURRENCY = 4

export async function scanOrganizeVault(
  now: number,
  active: () => boolean,
  title: string,
  summarize: (plan: OrganizePlan) => string,
) {
  await startAgentTaskCenter()
  await useDailySettingsStore.getState().initSettings()
  const workspace = useSettingStore.getState().workspacePath
  const identity = await currentWorkspaceIdentity()
  const index = useVaultIndexStore.getState()
  const absolutePath = (await getWorkspaceAbsolutePath()).replace(/\\/g, '/').replace(/\/+$/, '')
  const current = () => active() && workspace === useSettingStore.getState().workspacePath
    && index.revision === useVaultIndexStore.getState().revision && useVaultIndexStore.getState().status === 'ready'
  if (!current() || index.workspace !== absolutePath || index.notes.size > VAULT_LIMIT) return

  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const seen = new Set<string>()
  const blocked = new Set<string>()
  let pending = 0
  for (const task of agentTaskCenter.list()) {
    if (task.kind !== ORGANIZE_KIND) continue
    for (const draft of task.drafts) {
      const args = planOf(draft)
      if (!args || args.workspaceIdentity !== identity) continue
      seen.add(args.plan.key)
      if (draft.state !== 'pending') continue
      pending++
      for (const path of Object.keys(args.plan.mtimes)) blocked.add(path)
    }
  }
  const limit = PROPOSAL_LIMIT - pending
  if (limit <= 0) return

  const candidates = [...index.notes.values()].filter(note => eligible(note, now, dailyFolder, dailyPattern) && !blocked.has(note.path))
    .sort((a, b) => a.path.localeCompare(b.path))
  if (!candidates.length) return
  const start = (cursors.get(identity) ?? 0) % candidates.length
  const batch = [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, READ_LIMIT)
  let next = 0
  const results: Array<string | null> = []
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, batch.length) }, async () => {
    while (current() && next < batch.length) {
      const i = next++
      const note = batch[i]
      try {
        const before = await inspectNote(note.path, identity)
        if (before?.mtime !== note.mtime || before.size > NOTE_BYTES_LIMIT) continue
        const content = await readOrganizeNote(note.path, identity, NOTE_BYTES_LIMIT)
        if ((await inspectNote(note.path, identity))?.mtime === note.mtime) results[i] = content
      } catch {
        // Unreadable, changed or unsafe note. Leave it untouched.
      }
    }
  }))
  if (!current() || await currentWorkspaceIdentity() !== identity || !current()) return
  cursors.set(identity, start + batch.length)
  const contents = new Map<string, string>()
  for (const [i, note] of batch.entries()) {
    const content = results[i]
    if (typeof content === 'string') contents.set(note.path, content)
  }
  // PM review M2：接了同步就只提標籤與關聯
  const { isSyncConfigured } = await import('@/lib/sync/sync-manager')
  const allowMerge = !(await isSyncConfigured().catch(() => true))
  const plans = detectProposals({ notes: index.notes, contents, dailyFolder, dailyPattern, now, seen, blocked, limit, allowMerge })
  if (!plans.length || !current()) return
  await agentTaskCenter.submitDrafts({
    kind: ORGANIZE_KIND, title,
    drafts: plans.map(plan => buildOrganizeDraft(plan, workspace, identity, summarize(plan))),
  })
}
