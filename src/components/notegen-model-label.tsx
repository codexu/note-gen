'use client'

import { NOTEGEN_FREE_MODEL, NOTEGEN_LIMITED_MODEL } from '@/lib/ai/sponsored-model-limits'
import { getNoteGenModelPolicy } from '@/lib/ai/notegen-model-policy'

export function noteGenModelDisplayName(model: string, builtin: boolean, limitedName?: string): string {
  if (!builtin) return model
  const policy = getNoteGenModelPolicy()
  if (model === NOTEGEN_LIMITED_MODEL) return limitedName ?? policy.limited.displayName
  if (model === NOTEGEN_FREE_MODEL) return policy.free.displayName
  return model
}

export function NoteGenModelLabel({ model, limitedDetail, limitedName, builtin = false }: { model: string; limitedDetail: string; limitedName?: string; builtin?: boolean }) {
  const detail = builtin && model === NOTEGEN_LIMITED_MODEL ? limitedDetail : undefined

  return (
    <>
      <span>{noteGenModelDisplayName(model, builtin, limitedName)}</span>
      {detail && <span className="ml-1 text-xs font-normal text-muted-foreground">（{detail}）</span>}
    </>
  )
}
