import { appDataDir, join } from '@tauri-apps/api/path'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { isMobileDevice } from '@/lib/check'
import { getFilePathOptions } from '@/lib/workspace'

export async function showWorkspaceItemInFileManager(path: string) {
  const mobile = isMobileDevice()
  const options = await getFilePathOptions(path)
  const absolutePath = options.baseDir
    ? await join(await appDataDir(), options.path)
    : options.path

  // Mobile platforms do not support revealing an item in the file manager.
  if (mobile) {
    await openPath(absolutePath)
  } else {
    await revealItemInDir(absolutePath)
  }
}
