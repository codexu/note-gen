// Fork（almanac ALMNC-10）：接受或拒絕一條「等你定」項目＝回頭改來源的狀態，清單由投影自然更新。
// 不在這裡留任何待決紀錄。
import { agentTaskCenter, applyTaskDraft, discardTaskDrafts } from '@/lib/agent-tasks'
import { dailyNotePath, toDateKey } from '@/lib/daily/format'
import { acceptOrganizeDraft, rejectOrganizeDraft } from '@/lib/organize/review'
import { ORGANIZE_KIND } from '@/lib/organize/drafts'
import { jobCenter } from '@/lib/jobs'
import { readNote } from '@/lib/daily/note-io'
import { QUICK_ADD_SECTION } from '@/lib/today/today-actions'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'
import useDecideStore from '@/stores/decide'
import useSettingStore from '@/stores/setting'
import type { DecideItem, DecideRef } from './project'

/** 草稿衝突（檔案在草稿之後被改過）或寫入失敗：不在這裡硬寫，交給任務中心的審核畫面逐條確認。 */
export class DraftNotApplied extends Error {
  constructor(readonly taskId: string, readonly conflict: boolean, detail?: string) {
    super(detail ?? (conflict ? 'CONFLICT' : 'draft not applied'))
  }
}

export interface AcceptOutcome {
  /** 任務、時段寫進今日日誌時可復原。 */
  undo?: () => Promise<boolean>
}

/** 重新讀今日日誌，給預覽與「已在日誌裡」去重用；讀不到（沒有 Tauri 等）就維持原樣。 */
export async function refreshJournal(now: Date = new Date()): Promise<void> {
  try {
    await useDailySettingsStore.getState().initSettings()
    const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
    const path = dailyNotePath(now, dailyFolder, dailyPattern)
    const workspace = useSettingStore.getState().workspacePath
    const content = await readNote(path)
    if (workspace !== useSettingStore.getState().workspacePath) return
    useDecideStore.getState().setJournal({ before: content ?? '', fileMissing: content === null, section: QUICK_ADD_SECTION, today: toDateKey(now), path, workspace })
  } catch (error) {
    console.debug('[decide] journal read skipped:', error)
  }
}

function refs(item: DecideItem): DecideRef[] {
  return [item.ref, ...item.duplicates]
}

export async function acceptDecision(item: DecideItem): Promise<AcceptOutcome> {
  const { ref } = item
  if (ref.source === 'collect') {
    const store = useCollectStore.getState()
    const result = await store.accept(ref.itemId, ref.proposalId)
    // 同一件事的重複提案：寫過一次就夠，其餘標成不要
    for (const dup of item.duplicates) if (dup.source === 'collect') store.reject(dup.itemId, dup.proposalId)
    void refreshJournal()
    return result.record
      ? { undo: async () => {
          const ok = await useCollectStore.getState().undo(ref.itemId, ref.proposalId)
          void refreshJournal()
          return ok
        } }
      : {}
  }
  if (ref.source === 'job') {
    await jobCenter.act(ref.jobId, ref.stepId, 'accept')
    return {}
  }
  if (agentTaskCenter.get(ref.taskId)?.kind === ORGANIZE_KIND) {
    return { undo: await acceptOrganizeDraft(ref.taskId, ref.draftId) }
  }
  await applyTaskDraft(ref.taskId, ref.draftId)
  const draft = agentTaskCenter.get(ref.taskId)?.drafts.find(entry => entry.id === ref.draftId)
  if (draft?.state === 'failed') throw new DraftNotApplied(ref.taskId, draft.error === 'CONFLICT', draft.error)
  return {}
}

export async function rejectDecision(item: DecideItem): Promise<void> {
  for (const ref of refs(item)) {
    if (ref.source === 'collect') useCollectStore.getState().reject(ref.itemId, ref.proposalId)
    else if (ref.source === 'job') await jobCenter.act(ref.jobId, ref.stepId, 'reject')
    else if (agentTaskCenter.get(ref.taskId)?.kind === ORGANIZE_KIND) await rejectOrganizeDraft(ref.taskId, ref.draftId)
    else await discardTaskDrafts(ref.taskId, [ref.draftId])
  }
}
