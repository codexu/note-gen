import type { AgentTool, AgentUserQuestion } from '../types'

export const askUserQuestionTool: AgentTool = {
  name: 'ask_user_question',
  title: '询问用户',
  description: 'AskUserQuestion: use only when the user needs to choose between concrete options. Ask 1–4 concise single-choice or multiple-choice questions, each with 2–6 distinct options. For open-ended clarification, ask in your normal chat response and wait for the next user message instead. No free-text or Other option. Never use this for permission approval or answer on behalf of the user.',
  category: 'chat',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', minLength: 1, maxLength: 1000 },
            options: {
              type: 'array', minItems: 2, maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', minLength: 1, maxLength: 200 },
                  description: { type: 'string', maxLength: 500 },
                },
                required: ['label'], additionalProperties: false,
              },
            },
            multiSelect: { type: 'boolean', default: false },
          },
          required: ['question', 'options'], additionalProperties: false,
        },
      },
    },
    required: ['questions'], additionalProperties: false,
  },
  execute: async (input, context) => {
    const invalid = { ok: false, message: 'Provide 1–4 choice questions, each with 2–6 distinct, non-empty options. For open-ended questions, ask in the normal chat response instead.', error: 'INVALID_QUESTIONS' }
    if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 4) return invalid
    const questions: AgentUserQuestion[] = []
    for (const value of input.questions) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid
      const item = value as Record<string, unknown>
      if (typeof item.question !== 'string' || !item.question.trim() || item.question.length > 1000) return invalid
      if (item.multiSelect !== undefined && typeof item.multiSelect !== 'boolean') return invalid
      if (!Array.isArray(item.options)) return invalid
      const rawOptions = item.options as unknown[]
      if (rawOptions.length < 2 || rawOptions.length > 6) return invalid
      const options: AgentUserQuestion['options'] = []
      for (const value of rawOptions) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid
        const option = value as Record<string, unknown>
        if (typeof option.label !== 'string' || !option.label.trim() || option.label.length > 200) return invalid
        if (option.description !== undefined && (typeof option.description !== 'string' || option.description.length > 500)) return invalid
        options.push({ label: option.label.trim(), description: option.description as string | undefined })
      }
      if (new Set(options.map(option => option.label)).size !== options.length) return invalid
      questions.push({ question: item.question.trim(), options, multiSelect: item.multiSelect === true })
    }
    if (!context.requestUserQuestion) return { ok: false, message: 'Interactive questions are unavailable. Explain the missing information to the user.', error: 'QUESTION_UI_UNAVAILABLE' }
    const answers = await context.requestUserQuestion(questions, context.signal)
    return answers
      ? { ok: true, message: 'The user answered the questions. Continue using these answers.', data: { answers } }
      : { ok: false, message: 'The question was cancelled or superseded. Do not repeat it or assume an answer. Do not perform actions that require the missing information.', error: 'USER_CANCELLED_QUESTION' }
  },
}
