import { z } from 'zod'
import { validatePluginResourcePath } from '@notegen/plugin-api'

// Resource protocol 1 is independent of QuickJS RPC. The manifest validator
// composes this schema with dev's existing embedded-view resource validation.
const path = z.string().superRefine((value, context) => {
  try { validatePluginResourcePath(value) }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid resource path' }) }
})
export const codeBlockRendererSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$(?![\s\S])/),
  name: z.string().min(1).refine(value => Boolean(value.trim()) && new TextEncoder().encode(value).length <= 160 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)),
  languages: z.array(z.string().regex(/^[a-z0-9][a-z0-9_+.#-]{0,31}$(?![\s\S])/)).min(1).max(30)
    .refine(values => new Set(values).size === values.length),
  script: path.refine(value => value.endsWith('.js')),
  assets: z.array(path).max(100).refine(values => new Set(values).size === values.length).optional(),
}).strict()
export type CodeBlockRendererResource = z.infer<typeof codeBlockRendererSchema>
export const CODE_BLOCK_LIMITS = Object.freeze({ sourceBytes: 128 * 1024, resultBytes: 2 * 1024 * 1024, timeoutMs: 15_000 })
export interface CodeBlockRenderRequest {
  requestId: string
  language: string
  source: string
  theme: 'light' | 'dark'
  locale: string
}
export type CodeBlockRenderResult = { type: 'svg'; svg: string } | { type: 'png'; bytes: Uint8Array }

export function getCodeBlockRenderers(resources: unknown): CodeBlockRendererResource[] {
  if (!resources || typeof resources !== 'object' || !('codeBlockRenderers' in resources)) return []
  return z.array(codeBlockRendererSchema).max(30)
    .refine(values => new Set(values.map(value => value.id)).size === values.length)
    .parse(resources.codeBlockRenderers)
}
