import * as pdfjsLib from 'pdfjs-dist'
import { readFile } from '@tauri-apps/plugin-fs'
import { createWorker } from 'tesseract.js'
import { Store } from '@tauri-apps/plugin-store'

// 初始化 PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
}

// 类型守卫：检查是否为 TextItem
function isTextItem(item: any): item is { str: string; transform: number[] } {
  return item && typeof item.str === 'string' && Array.isArray(item.transform)
}

/**
 * 使用 OCR 识别 PDF 页面（用于图片型 PDF）
 */
async function ocrPage(canvas: HTMLCanvasElement, pageNum: number): Promise<string> {
  try {
    const store = await Store.load('store.json')
    const lang = await store.get<string>('tesseractList')
    const langArr = (lang as string)?.split(',') || ['eng']

    // 将 canvas 转换为图片数据
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png')
    })

    const worker = await createWorker(langArr)
    const ret = (await worker.recognize(blob)).data.text
    await worker.terminate()

    return ret
  } catch (error) {
    console.error(`OCR failed for page ${pageNum}:`, error)
    return ''
  }
}

/**
 * 从文件路径读取 PDF 并提取文本内容（Tauri 桌面应用）
 * @param filePath PDF 文件的本地路径
 * @param onProgress 进度回调函数
 * @returns 提取的文本内容
 */
export async function extractTextFromPDF(
  filePath: string,
  onProgress?: (progress: string) => void
): Promise<string> {
  try {
    // 使用 Tauri 的 readFile 读取文件为 Uint8Array
    const fileData = await readFile(filePath)

    // 加载 PDF 文档（直接传递 Uint8Array）
    const loadingTask = pdfjsLib.getDocument({ data: fileData })
    const pdfDocument = await loadingTask.promise

    onProgress?.(`读取 PDF (${pdfDocument.numPages} 页)`)

    let fullText = ''
    let needsOCR = false

    // 先尝试直接提取文本
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      const textItems = textContent.items

      if (textItems.length === 0) {
        needsOCR = true
        break
      }

      // 检查是否真的有文本内容（过滤掉空字符串）
      const hasRealText = textItems.some((item: any) =>
        isTextItem(item) && item.str.trim().length > 0
      )

      if (!hasRealText) {
        needsOCR = true
        break
      }
    }

    // 如果需要 OCR，使用 OCR 提取所有页面
    if (needsOCR) {
      onProgress?.('OCR 识别中...')
      return await extractTextWithOCR(pdfDocument, onProgress)
    }

    // 否则使用常规文本提取
    onProgress?.('提取文本中...')
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      const textItems = textContent.items

      // 按行组织文本
      const textByLine = new Map<number, any[]>()

      for (const item of textItems) {
        if (!isTextItem(item)) continue

        const y = Math.round(item.transform[5])
        if (!textByLine.has(y)) {
          textByLine.set(y, [])
        }
        textByLine.get(y)!.push(item)
      }

      const sortedY = Array.from(textByLine.keys()).sort((a, b) => b - a)

      for (const y of sortedY) {
        const lineItems = textByLine.get(y)!
        lineItems.sort((a, b) => a.transform[4] - b.transform[4])

        const lineText = lineItems
          .map((item: any) => item.str)
          .join('')
          .trim()

        if (lineText) {
          fullText += lineText + '\n'
        }
      }

      fullText += '\n'
      onProgress?.(`提取文本中 (${pageNum}/${pdfDocument.numPages})`)
    }

    const result = fullText.trim()
    return result
  } catch (error) {
    console.error('PDF text extraction error:', error)
    throw new Error('Failed to extract text from PDF')
  }
}

/**
 * 使用 OCR 从 PDF 中提取文本（用于图片型 PDF）
 */
async function extractTextWithOCR(
  pdfDocument: pdfjsLib.PDFDocumentProxy,
  onProgress?: (progress: string) => void
): Promise<string> {
  let fullText = ''

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    onProgress?.(`OCR 识别中 (${pageNum}/${pdfDocument.numPages})`)

    const page = await pdfDocument.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2.0 }) // 使用更高分辨率以提高 OCR 准确率

    // 创建 canvas
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.height = viewport.height
    canvas.width = viewport.width

    // 渲染 PDF 页面到 canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise

    // 使用 OCR 识别页面文本
    const pageText = await ocrPage(canvas, pageNum)
    if (pageText.trim()) {
      fullText += pageText.trim() + '\n\n'
    }
  }

  const result = fullText.trim()
  return result
}

/**
 * 从文件对象读取 PDF 并提取文本内容（移动端使用）
 * @param file PDF 文件对象
 * @returns 提取的文本内容
 */
export async function extractTextFromPDFFile(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()

    // 加载 PDF 文档
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    let fullText = ''

    // 遍历所有页面
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      // 提取文本并合并
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')

      fullText += pageText + '\n\n'
    }

    return fullText.trim()
  } catch (error) {
    console.error('PDF text extraction error:', error)
    throw new Error('Failed to extract text from PDF')
  }
}

/**
 * 获取 PDF 文件的基本信息
 * @param filePath PDF 文件的本地路径
 * @returns PDF 文件信息（页数等）
 */
export async function getPDFInfo(filePath: string): Promise<{ numPages: number }> {
  try {
    const response = await fetch(filePath)
    const arrayBuffer = await response.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    return {
      numPages: pdfDocument.numPages
    }
  } catch (error) {
    console.error('PDF info extraction error:', error)
    throw new Error('Failed to get PDF info')
  }
}

/**
 * 从文件对象获取 PDF 信息
 * @param file PDF 文件对象
 * @returns PDF 文件信息（页数等）
 */
export async function getPDFInfoFromFile(file: File): Promise<{ numPages: number }> {
  try {
    const arrayBuffer = await file.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    return {
      numPages: pdfDocument.numPages
    }
  } catch (error) {
    console.error('PDF info extraction error:', error)
    throw new Error('Failed to get PDF info')
  }
}
