import type { createLowlight } from 'lowlight'

let commonLowlightPromise: Promise<ReturnType<typeof createLowlight>> | null = null

export function getCommonLowlight() {
  commonLowlightPromise ??= import('lowlight').then(({ common, createLowlight }) => createLowlight(common))
  return commonLowlightPromise
}
