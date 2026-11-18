// Fork（almanac ALMNC-8）：收集頁問模型的那一步。沿用編輯器 AI 的設定（getEditorAISettings），
// 沒設定或呼叫失敗就丟錯，splitInput 會接住並退回規則拆分。
import { createOpenAIClient, getEditorAISettings, validateAIService, withEditorFastAiRequestOptions } from '@/lib/ai/utils'
export async function askCollectModel(prompt: string, imageDataUrl?: string, options?: { silent?: boolean }): Promise<string> {
  const aiConfig = await getEditorAISettings()
  if (!aiConfig) throw new Error('AI service not configured')
  const baseURL = options?.silent ? aiConfig.baseURL : await validateAIService(aiConfig.baseURL)
  if (!baseURL) throw new Error('AI service not configured')
  const openai = await createOpenAIClient(aiConfig)
  const content = imageDataUrl
    ? [{ type: 'text' as const, text: prompt }, { type: 'image_url' as const, image_url: { url: imageDataUrl } }]
    : prompt
  const completion = await openai.chat.completions.create(withEditorFastAiRequestOptions({
    model: aiConfig.model || '',
    messages: [{ role: 'user' as const, content }],
    temperature: 0.2,
  }, aiConfig))
  return completion.choices[0]?.message?.content || ''
}
