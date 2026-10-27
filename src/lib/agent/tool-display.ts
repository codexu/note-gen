import type { JsonSchema } from './types'

export const TOOL_DISPLAY_TITLE_KEY = '_display_title'

/** Display metadata is advertised to the model, but never passed to a tool. */
export function withToolDisplayTitle(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: {
      ...schema.properties,
      [TOOL_DISPLAY_TITLE_KEY]: {
        type: 'string',
        maxLength: 80,
        description: 'A short user-facing action title in the user\'s language, specific to this call, e.g. 搜索北京近期天气. Describe the action, not an unverified successful outcome. No technical tool names or Markdown.',
      },
    },
  }
}

export function takeToolDisplayTitle(params: Record<string, unknown>): string | undefined {
  const value = params[TOOL_DISPLAY_TITLE_KEY]
  delete params[TOOL_DISPLAY_TITLE_KEY]
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined : undefined
}
