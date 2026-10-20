import { appDataDir } from '@tauri-apps/api/path'
import { getFilePathOptions } from '@/lib/workspace'
import type { SkillScope } from './types'

export async function resolveSkillDirectory(skillDir: string, scope: SkillScope): Promise<string> {
  if (scope === 'global') {
    const appDataPath = await appDataDir()
    return `${appDataPath}/${skillDir}`
  }

  const options = await getFilePathOptions(skillDir)
  if (options.baseDir) {
    const appDataPath = await appDataDir()
    return `${appDataPath}/${options.path}`
  }
  return options.path
}
