import {
  createOpenAIClient,
  getEditorAISettings,
  withEditorFastAiRequestOptions,
} from '@/lib/ai/utils'

export function buildSyncCommitMessage(path: string) {
  const filename = path.split('/').filter(Boolean).pop() || path || 'file'
  return `Update ${filename}`.slice(0, 72)
}

export async function generateGitSyncCommitMessage(path: string, content: string) {
  const fallback = buildSyncCommitMessage(path)
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), 4000)
    : null

  try {
    const aiConfig = await getEditorAISettings()
    if (!aiConfig?.baseURL || !aiConfig?.model) {
      return fallback
    }

    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create(withEditorFastAiRequestOptions({
      model: aiConfig.model,
      messages: [
        {
          role: 'system',
          content: 'Generate one concise Git commit message. Output only the final message. Never output thinking, reasoning, analysis, or <think> tags.',
        },
        {
          role: 'user',
          content: `File: ${path}\n\nContent:\n${content.slice(0, 600)}${content.length > 600 ? '\n...' : ''}`,
        },
      ],
      temperature: 0.2,
      top_p: 1,
      max_tokens: 32,
    }, aiConfig), controller ? { signal: controller.signal } : undefined)

    const message = completion.choices[0]?.message.content?.trim()
    return message ? message.replace(/\s+/g, ' ').slice(0, 72) : fallback
  } catch {
    return fallback
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
