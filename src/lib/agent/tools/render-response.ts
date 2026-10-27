import type { Spec } from '@json-render/core'
import { getChatResponseText, parseChatResponseSpec, responseSpecJsonSchema } from '@/lib/chat-ui/response-catalog'
import { RESPONSE_LIMITS } from '@/lib/chat-ui/response-limits'
import type { AgentTool, JsonSchema } from '../types'

export const renderResponseTool: AgentTool = {
  name: 'render_response',
  title: '生成组件回复',
  category: 'chat',
  risk: 'read',
  description: [
    'Finish this turn with a complete read-only component reply. Choose this tool proactively for useful comparisons, options with repeated attributes, grouped summaries or recommendations, and plans or schedules with shared fields; the user does not need to request UI or json-render. Prefer Table for comparable rows and columns, Card for a meaningful standalone option or entity, and List for steps. Organize ordinary sections with Heading and Stack, without enclosing card frames. A meaningful comparison table or multiple parallel sections with the same fields should normally use this tool.',
    'Keep direct short answers, simple acknowledgements, continuous prose and copyable document/code content as ordinary Markdown. Respect the user\'s explicit output format. Do not create cards merely to decorate a short list or a routine operation-complete message, and do not append a separate task-results section.',
    'Finish all necessary operations and source citations first, then call this terminal tool alone. Include the entire final answer, including any introduction or conclusion, in one root/elements JSON spec; explanations may use Text or Markdown components. Do not add another answer after it succeeds.',
    'For progressive display, emit arguments in this order: title, then spec.root, then spec.elements. Within elements, put the root and parent layouts before their child elements, declaring child IDs in advance. Finish each element before starting the next so it can appear immediately. Prefer separate meaningful sections over one giant Markdown element. Keep the tool arguments as one valid JSON object; never send raw patches or JSONL in chat. The app compiles completed elements into SpecStream and previews them read-only until final validation succeeds.',
    `Reply budget: at most ${RESPONSE_LIMITS.elements} elements, ${RESPONSE_LIMITS.children} children per layout, tree depth ${RESPONSE_LIMITS.depth} (root at 0), ${RESPONSE_LIMITS.specChars} serialized characters, and ${RESPONSE_LIMITS.collectionItems} total collection entries/table cells. Use Heading and Stack for sections, and component item arrays for repeated content. When an actual Card helps, use its own title/description rather than adding wrappers. Group gallery examples without adding a card frame around every group.`,
    'If a reply exceeds a budget, simplify its structure and shorten examples while preserving the requested coverage, then retry once. Reuse resources already read and cited. If it still fails or UI is unavailable, return the full requested content in Markdown, with a brief rendering note if useful; never end with only a tool failure report.',
    'Layout/content: Stack(gap?:sm|md|lg), Card(title?,description?,icon?,variant?:plain|outlined), Text(text), Markdown(text), Heading(text,level?:2|3|4,icon?), List(items:string[],ordered?), Table(columns:string[],rows:string[][]). Card defaults to plain (no border, background surface or padding); use outlined only for a useful standalone card, never as the outer wrapper for the whole answer or every section. Only Stack/Card/Alert can have children. Tables have 1–12 columns and up to 100 rows, with matching cell counts.',
    'Semantic components: Alert(title,description?,variant?:default|warning|destructive,icon?); Badge(text,variant?,icon?); KeyValue(title?,items:[{label,value,icon?}]); Stat(label,value,description?,icon?); Steps(items:[{title,description?,status?:pending|current|done,icon?}]); Timeline(items:[{title,description?,time?,icon?}]); Accordion(items:[{title,content,icon?}],defaultOpen?:number[]); Tabs(items:[{title,content,icon?}],defaultIndex?:number); Quote(text,attribution?,sourceKey?); Progress(label,value:0..100,description?); Separator(). Accordion/Tabs content and Steps/Timeline descriptions support Markdown; other scalar fields are plain text. Never invent metrics, progress or completed statuses.',
    'Math(latex,displayMode?:boolean,label?) takes raw LaTeX WITHOUT dollar or bracket delimiters; escape backslashes in JSON. Prefer Math for formulas. CodeBlock(code,language?,title?) takes raw code WITHOUT Markdown fences and supplies highlighting and copying. For formulas in Markdown, use paired delimiters and put block $$ on separate lines; do not place formulas in plain Text, List or Table cells.',
    'Reference components: NoteLink(path,label?,icon?) opens an existing workspace-relative Markdown note. Sources(title?,items:[{sourceKey,label}]) and Quote.sourceKey reference actual knowledge tool source keys; finish required reading and citations first. ArtifactLink(path,label?,icon?) opens/saves an exact runtime-scanned output path. Image(src,alt,caption?) accepts an HTTPS URL or an exact scanned image artifact path. Never invent note paths, source keys, or artifact paths.',
    'ActionGroup(actions) supports only user-clicked host actions, each with type,label,icon?: copy(+text), open-note(+path), open-source(+sourceKey), open-artifact(+path), save-artifact(+path). It cannot perform agent mutations, approval or code execution. Icon(name,label,size?:sm|md|lg) is standalone; optional icon props use the same whitelist: file-text,folder,search,calendar,lightbulb,check-circle,triangle-alert,code,calculator,info,book-open,list-checks,clock,image,quote,link,external-link,copy,download,chart-column. Use icons to clarify meaning, not decorate every item.',
    'Title is an internal accessible name, not an automatically displayed heading. Omit unknown fields instead of inventing values. No NoteResult/OperationResult, inputs, arbitrary HTML/SVG, custom actions, expressions, scripts or permission requests. Tool success completes the reply.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      spec: responseSpecJsonSchema as JsonSchema,
    },
    required: ['title', 'spec'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) {
      return { ok: false, error: 'INVALID_RESPONSE_SPEC', message: 'Provide an internal reply name of 1–200 characters.' }
    }
    let spec: Spec
    let content: string
    try {
      spec = parseChatResponseSpec(input.spec)
      content = getChatResponseText(spec)
    } catch (error) {
      return { ok: false, error: 'INVALID_RESPONSE_SPEC', message: error instanceof Error ? error.message : String(error) }
    }
    if (!context.requestUserInteraction) {
      return { ok: false, error: 'UI_UNAVAILABLE', message: 'Component replies are unavailable. Finish with an ordinary Markdown reply.' }
    }
    const response = await context.requestUserInteraction({
      mode: 'display', placement: 'response', title: input.title.trim(), spec,
    }, { runId: context.runId, workspaceIdentity: context.workspaceIdentity, signal: context.signal })
    if (response.status === 'cancelled') {
      return { ok: false, error: 'USER_CANCELLED_UI', message: 'The component reply was cancelled or superseded.' }
    }
    if (response.status !== 'displayed') {
      return { ok: false, error: 'RESPONSE_UI_UNAVAILABLE', message: 'The reply could not be displayed. Finish with ordinary Markdown.' }
    }
    return { ok: true, message: 'The complete final reply was rendered.', data: { content } }
  },
}
