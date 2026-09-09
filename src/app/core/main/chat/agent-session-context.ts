import { readTextFile } from '@tauri-apps/plugin-fs'
import useChatStore from '@/stores/chat'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { isLinkedFolder, type LinkedResource, type MarkdownFile } from '@/lib/files'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { CanvasSelectionContext } from '@/types/canvas'
import type { ImageAttachment } from './image-attachments'
import type { ChatReasoningOverride } from '@/lib/ai/chat-reasoning'

export interface AgentQuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  selectionToken?: string
  articlePath: string
}

export interface AgentRequestSnapshot {
  reasoningOverride?: ChatReasoningOverride | null
  inputValue: string
  requestText: string
  linkedResource?: LinkedResource | null
  linkedResourcePreview?: string | null
  images: ImageAttachment[]
  fileAttachments: RuntimeChatAttachment[]
  quoteData: AgentQuoteData | null
  canvasSelectionContext: CanvasSelectionContext | null
  selectedSkillIds: string[]
  mentionedFiles: MarkdownFile[]
  mentionedRecords: AgentQuoteData[]
  mentionedCanvases: CanvasSelectionContext[]
}

export function getContextualArticleSnapshot(articleState: {
  activeFilePath: string
  currentArticle: string
}, isMobile: boolean) {
  const mobileContexts = useChatStore.getState().mobileActiveContexts
  const includeArticle = !isMobile || Boolean(mobileContexts.articlePath)
  return {
    activeFilePath: includeArticle ? articleState.activeFilePath : '',
    currentArticle: includeArticle ? articleState.currentArticle : '',
  }
}

export function buildCanvasSelectionContext(context: CanvasSelectionContext | null) {
  if (!context) return ''
  const nodeLabels = new Map(context.nodes.map(node => [node.id, node.label]))
  const nodes = context.nodes.length > 0
    ? context.nodes.map(node => {
        const details = [
          `id=${node.id}`,
          `type=${node.type}`,
          `label=${JSON.stringify(node.label)}`,
          node.description ? `description=${JSON.stringify(node.description)}` : '',
          node.filePath ? `filePath=${JSON.stringify(node.filePath)}` : '',
          node.recordId !== undefined ? `recordId=${node.recordId}` : '',
          node.url ? `url=${JSON.stringify(node.url)}` : '',
          node.checked !== undefined ? `checked=${node.checked}` : '',
          node.chart ? `chartData=${JSON.stringify({
            title: node.chart.title,
            type: node.chart.type,
            categoryLabel: node.chart.categoryLabel,
            series: node.chart.series,
            data: node.chart.data,
            primarySeriesId: node.chart.primarySeriesId,
            sourceFormat: node.chart.sourceFormat,
          })}` : '',
        ].filter(Boolean)
        return `- ${details.join('; ')}`
      }).join('\n')
    : '- 无'
  const edges = context.edges.length > 0
    ? context.edges.map(edge => (
        `- id=${edge.id}; source=${edge.source}${nodeLabels.has(edge.source) ? ` (${JSON.stringify(nodeLabels.get(edge.source))})` : ''}; target=${edge.target}${nodeLabels.has(edge.target) ? ` (${JSON.stringify(nodeLabels.get(edge.target))})` : ''}${edge.label ? `; label=${JSON.stringify(edge.label)}` : ''}`
      )).join('\n')
    : '- 无'
  const selectionGuidance = context.scope === 'selection'
    ? '以下节点是用户为本次对话明确选中的操作对象；连线包含用户选中的连线，以及所选节点之间已有的关联。回答或调用画布工具时优先使用这些精确 ID；除非用户明确要求，不要修改未选中的元素。'
    : '以下是用户关联的整个画布。回答时请结合节点内容与连线关系；调用画布工具时使用这里提供的精确 ID。'
  return [
    context.scope === 'selection' ? '## 用户选择的画布节点与关系' : '## 用户关联的画布',
    `画布：${context.canvasTitle}（ID: ${context.canvasId}）`,
    selectionGuidance,
    '',
    '节点：',
    nodes,
    '',
    '连线：',
    edges,
    '',
  ].join('\n')
}

export async function buildMentionedContext(input: {
  files: MarkdownFile[]
  records: AgentQuoteData[]
  canvases: CanvasSelectionContext[]
}) {
  let context = ''

  for (const file of input.files) {
    try {
      const workspace = await getWorkspacePath()
      const content = workspace.isCustom
        ? await readTextFile(file.path)
        : await getFilePathOptions(file.path).then(({ path, baseDir }) =>
            readTextFile(path, { baseDir })
          )
      context += ['## 用户通过 @ 关联的文件', `文件：${file.relativePath}`, '', content, ''].join('\n')
    } catch (error) {
      console.error('Failed to read @ mentioned file:', error)
    }
  }

  for (const record of input.records) {
    context += ['## 用户通过 @ 关联的记录', `记录：${record.fileName}`, '', record.fullContent, ''].join('\n')
  }

  for (const canvas of input.canvases) {
    context += buildCanvasSelectionContext(canvas)
  }

  return context
}

export async function buildAgentSteeringContext(request: AgentRequestSnapshot, isMobile: boolean) {
  const useArticleStore = (await import('@/stores/article')).default
  const activeArticle = getContextualArticleSnapshot(useArticleStore.getState(), isMobile)
  let context = ''

  if (activeArticle.activeFilePath && activeArticle.currentArticle) {
    context += `## 当前打开的笔记\n文件路径: ${activeArticle.activeFilePath}\n\n内容:\n${activeArticle.currentArticle}\n\n`
  }

  if (request.linkedResource && isLinkedFolder(request.linkedResource)) {
    context += `## 用户关联的笔记文件夹\n用户关联了文件夹“${request.linkedResource.name}”（${request.linkedResource.relativePath}）。需要查找笔记时优先使用这个 folderPath。\n\n`
  }

  if (request.linkedResource && !isLinkedFolder(request.linkedResource)) {
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = workspace.isCustom ? null : await getFilePathOptions(request.linkedResource.path)
      const linkedFileContent = workspace.isCustom
        ? await readTextFile(request.linkedResource.path)
        : await readTextFile(pathOptions!.path, { baseDir: pathOptions!.baseDir })
      context += `${request.linkedResourcePreview ? `${request.linkedResourcePreview}\n` : ''}## 关联文件完整内容\n${request.linkedResource.relativePath}\n\n${linkedFileContent}\n\n`
    } catch (error) {
      console.error('Failed to read linked file for steering:', error)
    }
  }

  if (request.quoteData) {
    context += `## 用户引用内容\n文件: ${request.quoteData.fileName}\n范围: ${request.quoteData.from}-${request.quoteData.to}\n\n${request.quoteData.fullContent}\n\n`
  }

  context += buildCanvasSelectionContext(request.canvasSelectionContext)
  context += await buildMentionedContext({
    files: request.mentionedFiles,
    records: request.mentionedRecords,
    canvases: request.mentionedCanvases,
  })
  return context
}
