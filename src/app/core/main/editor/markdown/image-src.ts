const PASSTHROUGH_IMAGE_SRC_PREFIXES = [
  'http://',
  'https://',
  'asset://',
  'tauri://',
  'data:',
  'blob:',
  'file:',
] as const

export function shouldKeepImageSrcAsIs(src: string | null | undefined): boolean {
  if (!src) {
    return false
  }

  return PASSTHROUGH_IMAGE_SRC_PREFIXES.some((prefix) => src.startsWith(prefix))
}

export function shouldTransformImageSrcToWorkspaceAsset(src: string | null | undefined): boolean {
  if (!src) {
    return false
  }

  return !shouldKeepImageSrcAsIs(src)
}
