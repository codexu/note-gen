import { getTags, insertTag, type Tag } from '@/db/tags'
import {
  resolveRecordSaveTargetId,
  type RecordSaveTargetMode,
} from '@/lib/record-save-preferences'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

let pendingTagCreation: Promise<unknown> = Promise.resolve()

// Serialize creation in the main window, including requests from quick capture.
export function createRecordTag(name: string): Promise<Tag> {
  const create = pendingTagCreation.then(async () => {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error('Empty tag name')
    const tags = await getTags()
    let tag = tags.find(item => item.name === trimmedName)
    if (!tag) {
      const result = await insertTag({ name: trimmedName })
      if (!result.lastInsertId) throw new Error('Failed to create tag')
      tag = { id: result.lastInsertId, name: trimmedName, isLocked: false, isPin: false }
    }
    await useTagStore.getState().fetchTags()
    return tag
  })
  pendingTagCreation = create.catch(() => undefined)
  return create
}

export async function getDefaultRecordSaveTagId(): Promise<number> {
  const tags = await getTags()
  const currentTagId = useTagStore.getState().currentTagId
  const {
    recordSaveTargetMode,
    fixedRecordTagId,
    lastRecordTagId,
  } = useSettingStore.getState()

  return resolveRecordSaveTargetId({
    mode: recordSaveTargetMode,
    currentTagId,
    lastTagId: lastRecordTagId,
    fixedTagId: fixedRecordTagId,
    availableTagIds: tags.map((tag) => tag.id),
  })
}

export function getRecordSaveTagIdFromTags({
  mode,
  currentTagId,
  lastTagId,
  fixedTagId,
  tagIds,
}: {
  mode: RecordSaveTargetMode
  currentTagId: number
  lastTagId: number | null
  fixedTagId: number | null
  tagIds: number[]
}): number {
  return resolveRecordSaveTargetId({
    mode,
    currentTagId,
    lastTagId,
    fixedTagId,
    availableTagIds: tagIds,
  })
}
