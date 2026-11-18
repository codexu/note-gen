import { z } from 'zod'
import type { AgentSettings } from '@/lib/agents/settings'
import { createOpenAIClient, getEditorAISettings, withEditorFastAiRequestOptions } from '@/lib/ai/utils'
import { createJob, MAX_JOB_STEPS, type JobPlan } from './schedule'

const text = (max: number) => z.string().trim().min(1).max(max)
const planSchema = z.object({
  title: text(120),
  steps: z.array(z.object({
    id: text(40),
    title: text(120),
    agent: z.number().int().positive(),
    prompt: text(4000),
    criterion: text(500),
    dependsOn: z.array(text(40)).max(MAX_JOB_STEPS),
  })).min(1).max(MAX_JOB_STEPS),
})

export function parseJobPlan(content: string, agents: AgentSettings[]): JobPlan {
  try {
    const json = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')
    const raw = planSchema.parse(JSON.parse(json))
    const plan: JobPlan = {
      title: raw.title,
      steps: raw.steps.map(({ agent, ...step }) => ({
        ...step,
        agentId: agents[agent - 1]?.id ?? '',
      })),
    }
    createJob(plan, { id: 'validation', threadKey: 'validation', now: 0 })
    return plan
  } catch {
    throw new Error('JOB_INVALID_PLAN')
  }
}

/** The chief assistant receives only the supplied request and agent roster. It has no tools. */
export async function proposeJob(request: string, agents: AgentSettings[], locale: string): Promise<JobPlan> {
  const config = await getEditorAISettings()
  if (!config?.baseURL || !config.model) throw new Error('JOB_MODEL_REQUIRED')
  const client = await createOpenAIClient(config)
  const response = await client.chat.completions.create(withEditorFastAiRequestOptions({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: [
          'You are the chief assistant. Propose a job card from the user request. Do not execute work.',
          `Write human-facing fields in ${locale}. Return only JSON, with up to ${MAX_JOB_STEPS} steps.`,
          'Select agents from the supplied roster using their numeric index and match their capabilities.',
          'Give each step a unique string ID, self-contained instructions, and one verifiable acceptance criterion.',
          'In dependsOn, reference only step IDs whose results are needed. No cycles.',
          'Shape: {"title":"…","steps":[{"id":"s1","title":"…","agent":1,"prompt":"…","criterion":"…","dependsOn":[]}]}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          request,
          agents: agents.map(({ name, role, allowedTools }, index) => ({ index: index + 1, name, role, allowedTools })),
        }),
      },
    ],
  }, config))
  return parseJobPlan(response.choices[0]?.message?.content ?? '', agents)
}
