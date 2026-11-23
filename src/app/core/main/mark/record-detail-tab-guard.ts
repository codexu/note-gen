export type RecordTabCloseGuard = () => 'dirty' | 'saving' | null

const guardsByGroup = new Map<string, Map<string, RecordTabCloseGuard>>()

export function registerRecordTabCloseGuard(groupId: string, tabId: string, read: RecordTabCloseGuard) {
  const group = guardsByGroup.get(groupId) ?? new Map<string, RecordTabCloseGuard>()
  const guard = () => read()
  guardsByGroup.set(groupId, group)
  group.set(tabId, guard)

  return () => {
    if (group.get(tabId) !== guard) return
    group.delete(tabId)
    if (!group.size) guardsByGroup.delete(groupId)
  }
}

export function getRecordTabCloseGuards(groupId: string, tabIds: readonly string[]) {
  const group = guardsByGroup.get(groupId)
  if (!group) return []

  return tabIds.flatMap(tabId => {
    const guard = group.get(tabId)
    return guard ? [guard] : []
  })
}
