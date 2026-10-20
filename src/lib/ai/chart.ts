import {
  createOpenAIClient,
  getEditorAISettings,
  withEditorFastAiRequestOptions,
} from './utils'
import {
  createEmptyChartInput,
  createGeneratedChartTitle,
  createChartSpec,
  parseAiChartCollection,
  parseChartInput,
  parseJsonFromAiResponse,
} from '@/lib/canvas/chart-data'
import type { CanvasChartRequest, CanvasChartType } from '@/types/canvas'

export interface CanvasChartSource {
  name: string
  content: string
}

export async function transformChartInputsWithAI(
  source: string,
  signal?: AbortSignal
) {
  const aiConfig = await getEditorAISettings()
  if (!aiConfig?.baseURL || !aiConfig.model) throw new Error('CHART_AI_NOT_CONFIGURED')
  const client = await createOpenAIClient(aiConfig)
  const prompt = `Find every independent dataset in the user's content and convert each one into a chart dataset.

Strict rules:
- Never invent, estimate, calculate, aggregate, interpolate, or complete numeric values.
- Every output number must occur in the user's input. Unit normalization is allowed (for example 1万 to 10000).
- Preserve the user's category and series meaning.
- Return one chart for each independent dataset. Do not merge unrelated datasets.
- Always provide a distinct concise title for every chart.
- Return JSON only, without Markdown or explanation.
- Return no more than 8 charts, with no more than 5 series and 100 data rows per chart.
- recommendedType must be one of: area, bar, line, pie, radar, radial.

JSON shape:
{
  "charts": [{
    "title": "concise dataset title",
    "categoryLabel": "category field name",
    "recommendedType": "bar",
    "series": [{"name": "series name"}],
    "data": [{"label": "category", "values": [12.5]}]
  }]
}

User input:
${source}`
  const completion = await client.chat.completions.create(withEditorFastAiRequestOptions({
    model: aiConfig.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  }, aiConfig), { signal })
  return parseAiChartCollection(
    parseJsonFromAiResponse(completion.choices[0]?.message?.content || ''),
    source
  )
}

export function chartTypeLabelKey(type: CanvasChartType) {
  return `chart.types.${type}` as const
}

function resolveChartTitle(
  request: CanvasChartRequest,
  input: Parameters<typeof createGeneratedChartTitle>[0],
  generatedTitle = ''
) {
  if (request.titleMode === 'manual') return request.title
  return generatedTitle.trim() || createGeneratedChartTitle(input) || request.title
}

function containsMultipleDatasets(content: string) {
  const markdownTableCount = content
    .split(/\r?\n/)
    .filter(line => /^\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}/.test(line))
    .length
  const fencedBlockCount = [...content.matchAll(/```(?:csv|tsv|json|md|markdown)?\s*\n[\s\S]*?```/gi)].length
  return markdownTableCount > 1 || fencedBlockCount > 1
}

export async function generateCanvasChart(
  request: CanvasChartRequest,
  signal?: AbortSignal
) {
  return (await generateCanvasCharts(
    request,
    [{ name: 'Input', content: request.source }],
    signal
  ))[0]
}

export async function generateCanvasCharts(
  request: CanvasChartRequest,
  sources: CanvasChartSource[],
  signal?: AbortSignal
) {
  const usableSources = sources.filter(source => source.content.trim())
  const combinedSource = usableSources
    .map(source => `## ${source.name}\n${source.content.trim()}`)
    .join('\n\n')
  const manualTitle = request.titleMode === 'manual' ? request.title.trim() : ''
  if (usableSources.length === 0) {
    const input = createEmptyChartInput()
    return [createChartSpec(
      request.source,
      input,
      request.requestedType,
      resolveChartTitle(request, input)
    )]
  }
  if (usableSources.length > 0) {
    const locallyParsed = usableSources.map(source => {
      try {
        if (containsMultipleDatasets(source.content)) return null
        return { source, input: parseChartInput(source.content) }
      } catch {
        return null
      }
    })
    if (locallyParsed.every((item): item is NonNullable<typeof item> => item !== null)) {
      return locallyParsed.map(({ source, input }, index) => createChartSpec(
        source.content,
        input,
        request.requestedType,
        manualTitle
          ? `${manualTitle}${locallyParsed.length > 1 ? ` ${index + 1}` : ''}`
          : resolveChartTitle(request, input)
      ))
    }
  }
  try {
    const transformed = await transformChartInputsWithAI(combinedSource, signal)
    return transformed.map((chart, index) => createChartSpec(
      combinedSource,
      chart.input,
      request.requestedType,
      manualTitle
        ? `${manualTitle}${transformed.length > 1 ? ` ${index + 1}` : ''}`
        : resolveChartTitle(request, chart.input, chart.title),
      chart.recommendedType
    ))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const input = createEmptyChartInput()
    return [createChartSpec(
      combinedSource || request.source,
      input,
      request.requestedType,
      resolveChartTitle(request, input)
    )]
  }
}

export function getChartErrorCode(error: unknown) {
  if (error instanceof Error && /^CHART_[A-Z_]+$/.test(error.message)) return error.message
  return 'CHART_UNKNOWN_ERROR'
}
