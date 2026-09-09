import { Store } from '@tauri-apps/plugin-store'
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { v4 as uuidv4 } from 'uuid'
import { isImageHostingReady, uploadImage } from './imageHosting'
import { getFilePathOptions, isAbsoluteFsPath, toWorkspaceRelativePath } from './workspace'
import { convertImageByWorkspace } from './utils'
import { toMarkdownImagePath } from './markdown-image-path'
import { getWritingAssetsDirName } from './writing-assets-path'
import useArticleStore from '@/stores/article'
import {
  captureStaticAssetSyncSource,
  enqueueStaticAssetSync,
  uploadStaticAssetNow,
} from '@/lib/sync/static-asset-sync-queue'

export interface ImageUploadResult {
  /** Webview 可访问的 URL（用于编辑器显示） */
  src: string
  /** 用于 Markdown 保存的路径 */
  relativePath: string
  /** 是否使用了图床上传 */
  useImageHosting: boolean
}

/**
 * 将图片直接保存到笔记工作区，不经过图床。
 * 适用于已经存在于本地的资源，例如记录整理时引用的图片。
 */
export async function saveImageToWorkspace(
  file: File,
  activeFilePath: string
): Promise<ImageUploadResult> {
  const syncSource = captureStaticAssetSyncSource()
  const { imageRelativePath, markdownRelativePath } = await saveImageLocally(file, activeFilePath)
  const articleStore = useArticleStore.getState()

  if (articleStore.syncStaticAssets) {
    enqueueStaticAssetSync(imageRelativePath, syncSource)
    try {
      await uploadStaticAssetNow(imageRelativePath, syncSource)
    } catch (error) {
      console.error('[ImageHandler] Failed to auto-upload local image:', error)
    }
  }

  return {
    src: await convertImageByWorkspace(imageRelativePath),
    relativePath: markdownRelativePath,
    useImageHosting: false,
  }
}

/**
 * 处理图片文件：上传到图床或保存到本地
 * @param file 图片文件
 * @param activeFilePath 当前编辑的文件路径（用于确定本地保存位置）
 * @returns 图片 URL 或本地路径
 */
export async function handleImageUpload(
  file: File,
  activeFilePath?: string
): Promise<ImageUploadResult> {
  // 检查是否配置了图床
  const isConfigured = await isImageHostingConfigured()

  // 1. 如果配置了图床，尝试上传
  if (isConfigured) {
    try {
      const imageHostingUrl = await uploadImage(file)
      if (imageHostingUrl) {
        return {
          src: imageHostingUrl,
          relativePath: imageHostingUrl,
          useImageHosting: true,
        }
      }
      // 如果返回 undefined，说明上传失败（配置了图床但上传返回空）
      // 抛出错误，不要静默失败
      throw new Error('Image hosting upload returned empty result')
    } catch (error) {
      console.error('[ImageHandler] Failed to upload to image hosting:', error)
      // 图床上传失败，抛出错误而不是回退到本地保存
      throw error
    }
  }

  // 2. 如果没有配置图床，保存到本地
  if (activeFilePath) {
    try {
      return await saveImageToWorkspace(file, activeFilePath)
    } catch (error) {
      console.error('Failed to save image locally:', error)
      throw error
    }
  }

  throw new Error('No image hosting configured and no active file path for local storage')
}

/**
 * 将图片保存到与 Markdown 文件相同的目录
 * @param file 图片文件
 * @param markdownPath Markdown 文件的路径（可以是完整路径、相对路径或文件名）
 * @returns 图片的工作区相对路径，以及写回 Markdown 时应使用的相对路径
 */
async function saveImageLocally(file: File, markdownPath: string): Promise<{
  imageRelativePath: string
  markdownRelativePath: string
}> {
  // 生成唯一的图片文件名
  const ext = file.name.split('.').pop() || 'png'
  const filename = `${uuidv4()}.${ext}`.replace(/\s/g, '_')

  const store = await Store.load('store.json')
  const assetsDirName = getWritingAssetsDirName(await store.get<string>('assetsPath'))
  const workspaceRelativeMarkdownPath = await toWorkspaceRelativePath(markdownPath)
  const normalizedMarkdownPath = workspaceRelativeMarkdownPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
  // 工作区外的绝对路径不能参与相对层级计算，保持原有的根目录回退行为。
  const markdownPathForStorage = isAbsoluteFsPath(normalizedMarkdownPath)
    ? normalizedMarkdownPath.split('/').pop() || ''
    : normalizedMarkdownPath
  const markdownDir = markdownPathForStorage.includes('/')
    ? markdownPathForStorage.slice(0, markdownPathForStorage.lastIndexOf('/'))
    : ''

  // 构建图片的相对路径
  // 如果 markdownDir 是空字符串（根目录），图片直接保存在 images 目录
  // 否则保存在 markdownDir/images 目录
  const imageDir = markdownDir ? `${markdownDir}/${assetsDirName}` : assetsDirName
  const imageRelativePath = `${imageDir}/${filename}`

  // 确保目录存在
  await ensureDirectoryExists(imageDir)

  // 读取并保存文件
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  const pathOptions = await getFilePathOptions(imageRelativePath)

  await writeFile(pathOptions.path, uint8Array, {
    baseDir: pathOptions.baseDir,
  })

  // 返回相对于工作区的路径
  const workspaceRelativeImagePath = await toWorkspaceRelativePath(imageRelativePath)
  await syncImageIntoFileTree(imageDir, workspaceRelativeImagePath)

  return {
    imageRelativePath: workspaceRelativeImagePath,
    markdownRelativePath: toMarkdownImagePath(markdownPathForStorage, workspaceRelativeImagePath),
  }
}

async function syncImageIntoFileTree(imageDir: string, imagePath: string): Promise<void> {
  const articleStore = useArticleStore.getState()
  const parentDir = imageDir.includes('/') ? imageDir.slice(0, imageDir.lastIndexOf('/')) : ''
  const expandedPaths = new Set(articleStore.collapsibleList)
  const parentWasExpanded = parentDir ? expandedPaths.has(parentDir) : false
  const assetDirWasExpanded = expandedPaths.has(imageDir)

  const insertedDir = articleStore.insertLocalEntry(imageDir, true)
  const insertedFile = articleStore.insertLocalEntry(imagePath, false)

  if (parentWasExpanded) {
    await articleStore.loadCollapsibleFiles(parentDir, { force: true })
  }

  if (assetDirWasExpanded) {
    await articleStore.loadCollapsibleFiles(imageDir, { force: true })
  } else if (!insertedDir || !insertedFile) {
    await articleStore.loadCollapsibleFiles(imageDir, { force: true })
  }
}

/**
 * 确保目录存在，如果不存在则创建
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const pathOptions = await getFilePathOptions(dirPath)

    // 检查目录是否已存在
    const dirExists = await exists(pathOptions.path, {
      baseDir: pathOptions.baseDir,
    })

    if (!dirExists) {
      // 如果目录不存在，创建它
      await mkdir(pathOptions.path, {
        baseDir: pathOptions.baseDir,
        recursive: true,
      })
    }
  } catch {
    // 目录可能不存在，但这是正常的
  }
}

/**
 * 检查是否配置了图床
 */
export async function isImageHostingConfigured(): Promise<boolean> {
  return await isImageHostingReady()
}

/**
 * 将 File 对象转换为 base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      resolve(reader.result as string)
    }
    reader.onerror = (error) => {
      reject(error)
    }
  })
}
