import { Store } from '@tauri-apps/plugin-store'
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { dirname } from '@tauri-apps/api/path'
import { v4 as uuidv4 } from 'uuid'
import { uploadImage } from './imageHosting'
import { getFilePathOptions, toWorkspaceRelativePath, getWorkspacePath } from './workspace'
import { convertImageByWorkspace } from './utils'
import { toMarkdownImagePath } from './markdown-image-path'
import { getNormalizedImageHosting } from './image-hosting-config'
import { getWritingAssetsDirName } from './writing-assets-path'
import useArticleStore from '@/stores/article'

export interface ImageUploadResult {
  /** Webview 可访问的 URL（用于编辑器显示） */
  src: string
  /** 用于 Markdown 保存的路径 */
  relativePath: string
  /** 是否使用了图床上传 */
  useImageHosting: boolean
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
      const { imageRelativePath, markdownRelativePath } = await saveImageLocally(file, activeFilePath)
      // 将本地路径转换为 Webview 可访问的 URL
      const webviewUrl = await convertImageByWorkspace(imageRelativePath)
      return {
        src: webviewUrl,
        relativePath: markdownRelativePath,
        useImageHosting: false,
      }
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

  // 获取工作区路径信息
  const workspace = await getWorkspacePath()
  const store = await Store.load('store.json')
  const assetsDirName = getWritingAssetsDirName(await store.get<string>('assetsPath'))

  // 检查 markdownPath 是否只包含文件名（不包含路径分隔符）
  let markdownDir: string = ''

  // 如果 markdownPath 包含路径分隔符，才解析目录
  if (markdownPath.includes('/') || markdownPath.includes('\\')) {
    if (workspace.isCustom) {
      // 自定义工作区
      const fullDir = await dirname(markdownPath)
      // 提取相对于工作区的部分
      if (fullDir.startsWith(workspace.path)) {
        markdownDir = fullDir.substring(workspace.path.length).replace(/^\//, '')
      } else {
        markdownDir = '' // 不在 workspace 内，使用根目录
      }
    } else {
      // 默认工作区（AppData/article）
      // 解析 markdown 文件路径，获取其相对于 article 的路径
      const pathOptions = await getFilePathOptions(markdownPath)
      // 移除 article/ 前缀获取相对路径
      const relativeMarkdownPath = pathOptions.path.replace(/^article\//, '')
      markdownDir = await dirname(relativeMarkdownPath)
    }
  }
  // 如果 markdownDir 是空字符串，说明是根目录

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
    markdownRelativePath: toMarkdownImagePath(markdownPath, workspaceRelativeImagePath),
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
  const store = await Store.load('store.json')
  const useImageRepo = await store.get<boolean>('useImageRepo')
  const savedMainImageHosting = await store.get<string>('mainImageHosting')
  const normalizedImageHosting = getNormalizedImageHosting(savedMainImageHosting)
  const mainImageHosting = useImageRepo ? normalizedImageHosting.value : savedMainImageHosting
  const isConfigured = !!(useImageRepo && mainImageHosting && mainImageHosting !== 'none')

  if (useImageRepo && normalizedImageHosting.shouldPersist) {
    await store.set('mainImageHosting', normalizedImageHosting.value)
    await store.save()
  }

  return isConfigured
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
