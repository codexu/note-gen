import { exists, BaseDirectory, createDir } from '@tauri-apps/api/fs';

async function create(path: string) {
  const isExists = await exists(path, { dir: BaseDirectory.AppData })
  if (!isExists) {
    await createDir(path, { dir: BaseDirectory.AppData })
  }
}
export default async function createDefaultFolder() {
  ['article', 'article/默认文件夹', 'screenshot'].forEach(async (item) => {
    await create(item)
  })
}

export const ignoreFolders = [
  '.DS_Store',
]