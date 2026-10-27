import { chatUiSpecJsonSchema, parseChatUiRequest } from '@/lib/chat-ui/catalog'
import type { ChatUiRequest } from '@/lib/chat-ui/types'
import type { AgentTool, JsonSchema } from '../types'

export const showUiTool: AgentTool = {
  name: 'show_ui',
  title: '展示交互组件',
  category: 'chat',
  risk: 'read',
  description: 'Show a NoteGen UI during an unfinished task. Use collect mode when the user needs to choose workspace notes/folders/tags or supply several related fields; await actual submission before acting. Use display only for information needed before the task continues. For the complete final answer, choose ordinary Markdown or render_response according to the final-reply format rules; use ask_user_question for simple choices. Never ask again for information already supplied or use this tool as permission approval. Supply one complete JSON spec with root and a flat elements map. Each element has type, props, children (empty for leaf fields). Only Stack/Card have children. Fields need a unique simple name and a label. Supported types: Stack, Card, Text(text), Input, Textarea, Select(options), CheckboxGroup(options), NotePicker(multiple), FolderPicker, TagPicker(multiple). Field props: name,label,description?,required?,defaultValue?; Input/Textarea also placeholder?. Option shape: {label,value}. Multiple defaults must be arrays. Domain pickers load real options locally; never supply options. Root folder is dot. No state bindings, expressions, actions, HTML or scripts. The app supplies submit/cancel controls. Do not collect input when you already have enough information to complete the task.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['display', 'collect'] },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      spec: chatUiSpecJsonSchema as JsonSchema,
    },
    required: ['mode', 'title', 'spec'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    let request: ChatUiRequest
    try { request = parseChatUiRequest(input) } catch (error) {
      return { ok: false, error: 'INVALID_UI_SPEC', message: error instanceof Error ? error.message : String(error) }
    }
    if (!context.requestUserInteraction) return { ok: false, error: 'UI_UNAVAILABLE', message: 'Interactive UI is unavailable in this context. Continue using normal text or existing tools.' }
    const response = await context.requestUserInteraction(request, {
      runId: context.runId, workspaceIdentity: context.workspaceIdentity, signal: context.signal,
    })
    return response.status === 'cancelled'
      ? { ok: false, error: 'USER_CANCELLED_UI', message: 'The UI was cancelled or superseded. Do not assume values or perform actions that depend on missing input.' }
      : { ok: true, message: response.status === 'submitted' ? 'The user submitted the form. Continue using these values through the existing tools and permission checks.' : 'The UI was displayed.', data: response }
  },
}
