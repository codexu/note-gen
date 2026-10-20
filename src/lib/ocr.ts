import { BaseDirectory, exists, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'

import {
  getActiveOcrProvider,
  runInstalledOcrProvider,
} from '@/lib/ocr-packages'

const DEFAULT_OCR_TIMEOUT_MS = 30000
const OCR_TEMP_DIR = 'temp_ocr'
const DEFAULT_OCR_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en-US', 'ja-JP', 'ko-KR']

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('OCR 识别超时')), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function ensureOcrTempDir(): Promise<void> {
  if (!(await exists(OCR_TEMP_DIR, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(OCR_TEMP_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

async function recognizeImagePath(path: string, timeoutMs = DEFAULT_OCR_TIMEOUT_MS): Promise<string> {
  const activeProvider = await getActiveOcrProvider()

  if (!activeProvider) {
    throw new Error('当前平台暂无内置 OCR 引擎')
  }

  return withTimeout(runInstalledOcrProvider({
    providerId: activeProvider.id,
    imagePath: path,
    languages: DEFAULT_OCR_LANGUAGES,
  }), timeoutMs)
}

export async function recognizeImageBlob(
  blob: Blob,
  timeoutMs = DEFAULT_OCR_TIMEOUT_MS
): Promise<string> {
  await ensureOcrTempDir()

  const filePath = `${OCR_TEMP_DIR}/${crypto.randomUUID()}.png`
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData })

  try {
    return await recognizeImagePath(filePath, timeoutMs)
  } finally {
    await remove(filePath, { baseDir: BaseDirectory.AppData }).catch(() => undefined)
  }
}

export default async function ocr(path: string): Promise<string> {
  try {
    return await recognizeImagePath(path)
  } catch (error) {
    console.warn('OCR recognition failed:', error)
    return ''
  }
}
