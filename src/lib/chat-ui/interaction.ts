import { getChatById, updateChatUiBlocks } from '@/db/chats'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import { getWorkspacePath } from '@/lib/workspace'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { getChatUiInitialValues, validateChatUiValues } from './catalog'
import { validateChatUiDomainValues } from './domain'
import { parseChatUiBlocks } from './serialization'
import { validateResultReferences } from './result-catalog'
import { fingerprintWorkspaceIdentity } from './workspace'
import { getChatResponseNotePaths, validateChatResponseReferences } from './response-catalog'
import { getChatResponseSources, verifyResponseNote } from './response-host'
import { getAgentArtifactPaths } from '@/lib/agent/artifacts'
import type { ChatUiBlock, ChatUiRequest, ChatUiResponse, ChatUiValues, RequestChatUi } from './types'

interface InteractionTarget {
  chatId: number
  conversationId?: number
}

interface ActiveInteraction extends InteractionTarget {
  block: ChatUiBlock
  signal?: AbortSignal
  workspacePath: string
  claimed: boolean
  cancelled: boolean
  settled: boolean
  resolve: (response: ChatUiResponse) => void
  result: Promise<ChatUiResponse>
  cleanup: () => void
}

const activeInteractions = new Map<string, ActiveInteraction>()
const pendingWrites = new Map<number, Promise<void>>()
const MAX_UI_BLOCKS = 20
const MAX_UI_STORAGE_CHARS = 1_000_000
let interactionRevision = 0

/** Only update UI data: a streaming answer may be changing the other message fields. */
async function persistBlock(chatId: number, block: ChatUiBlock): Promise<void> {
  const previous = pendingWrites.get(chatId) || Promise.resolve()
  const write = previous.catch(() => undefined).then(async () => {
    const current = useChatStore.getState().chats.find(chat => chat.id === chatId)
    const message = chatId < 0 ? current : await getChatById(chatId)
    if (!message) throw new Error('CHAT_UI_MESSAGE_UNAVAILABLE')

    const raw = message.uiBlocks
    let stored: unknown = []
    if (raw) {
      if (raw.length > MAX_UI_STORAGE_CHARS) throw new Error('CHAT_UI_STORAGE_LIMIT')
      try {
        stored = JSON.parse(raw) as unknown
      } catch {
        throw new Error('CHAT_UI_HISTORY_INVALID')
      }
    }
    if (!Array.isArray(stored)) throw new Error('CHAT_UI_HISTORY_INVALID')
    if (stored.length > MAX_UI_BLOCKS) throw new Error('CHAT_UI_STORAGE_LIMIT')
    const blocks = parseChatUiBlocks(raw)
    // A reader may skip invalid or future blocks; a writer must never erase them.
    if (blocks.length !== stored.length || new Set(blocks.map(item => item.id)).size !== blocks.length) {
      throw new Error('CHAT_UI_HISTORY_INVALID')
    }
    const index = blocks.findIndex(item => item.id === block.id)
    if (index < 0) blocks.push(block)
    else blocks[index] = block
    if (blocks.length > MAX_UI_BLOCKS) throw new Error('CHAT_UI_STORAGE_LIMIT')
    const uiBlocks = JSON.stringify(blocks)
    if (uiBlocks.length > MAX_UI_STORAGE_CHARS) throw new Error('CHAT_UI_STORAGE_LIMIT')

    if (chatId >= 0) await updateChatUiBlocks(chatId, uiBlocks)
    useChatStore.setState(state => ({
      chats: state.chats.map(chat => chat.id === chatId ? { ...chat, uiBlocks } : chat),
    }))
  })
  pendingWrites.set(chatId, write)
  try {
    await write
  } finally {
    if (pendingWrites.get(chatId) === write) pendingWrites.delete(chatId)
  }
}

function isActive(interaction: ActiveInteraction, requireVisible = false): boolean {
  const store = useChatStore.getState()
  const pending = store.agentState.pendingUiInteraction
  return !interaction.settled
    && !interaction.cancelled
    && activeInteractions.get(interaction.block.id) === interaction
    && pending?.id === interaction.block.id
    && pending.chatId === interaction.chatId
    && pending.runId === interaction.block.runId
    && pending.workspaceIdentity === interaction.block.workspaceIdentity
    && store.agentState.runId === interaction.block.runId
    && store.agentState.activeChatId === interaction.chatId
    && store.agentState.isRunning
    && !interaction.signal?.aborted
    && useSettingStore.getState().workspacePath === interaction.workspacePath
    && (interaction.chatId >= 0 || (store.isTemporaryConversation && store.chats.some(chat => chat.id === interaction.chatId)))
    && (!requireVisible || (store.currentConversationId ?? undefined) === interaction.conversationId)
    && ((store.currentConversationId ?? undefined) !== interaction.conversationId
      || store.chats.some(chat => chat.id === interaction.chatId))
}

async function hasSameWorkspace(interaction: ActiveInteraction): Promise<boolean> {
  return getSkillWorkspaceIdentity(await getWorkspacePath()) === interaction.block.workspaceIdentity
}

function finish(interaction: ActiveInteraction, response: ChatUiResponse): void {
  if (interaction.settled) return
  interaction.settled = true
  interaction.cleanup()
  activeInteractions.delete(interaction.block.id)
  const store = useChatStore.getState()
  if (store.agentState.pendingUiInteraction?.id === interaction.block.id) {
    store.setAgentState({
      pendingUiInteraction: undefined,
      ...(store.agentState.runId === interaction.block.runId && store.agentState.isRunning
        ? { status: 'calling_tool' as const }
        : {}),
    })
  }
  interaction.resolve(response)
}

async function cancel(interaction: ActiveInteraction): Promise<void> {
  interaction.cancelled = true
  if (interaction.settled) return
  // An in-flight submission owns the write and observes cancellation before resolving.
  if (interaction.claimed) {
    await interaction.result
    return
  }
  interaction.claimed = true
  interaction.block = { ...interaction.block, status: 'cancelled' }
  try {
    await persistBlock(interaction.chatId, interaction.block)
  } catch (error) {
    // Cancellation must still release the runtime when its message was deleted.
    console.error('Unable to persist cancelled conversation UI', error)
  } finally {
    finish(interaction, { status: 'cancelled' })
  }
}

/** Also invalidates requests still saving their initial card before a waiter exists. */
export function cancelActiveChatUiInteractions(): void {
  interactionRevision += 1
  for (const interaction of activeInteractions.values()) void cancel(interaction)
}

/** The callback is bound to the original message, including while another chat is visible. */
export async function requestChatUiInteraction(
  request: ChatUiRequest,
  context: Parameters<RequestChatUi>[1],
  target: InteractionTarget,
): Promise<ChatUiResponse> {
  const revision = interactionRevision
  if (context.signal?.aborted) return { status: 'cancelled' }
  const workspaceIdentity = getSkillWorkspaceIdentity(await getWorkspacePath())
  if (context.workspaceIdentity && context.workspaceIdentity !== workspaceIdentity) return { status: 'cancelled' }
  const workspacePath = useSettingStore.getState().workspacePath
  const sourceState = useChatStore.getState().agentState
  if (request.placement === 'result') {
    if (sourceState.runId !== context.runId || sourceState.activeChatId !== target.chatId) return { status: 'cancelled' }
    validateResultReferences(request.spec, { changes: sourceState.changes ?? [], toolCalls: sourceState.toolCalls })
  }
  const sourceToolName = request.placement === 'response' ? 'render_response'
    : request.placement === 'result' ? 'show_result' : 'show_ui'
  const sourceTrace = sourceState.runId === context.runId
    ? sourceState.traceEvents?.findLast(event => event.runId === context.runId && event.type === 'tool_call' && event.toolName === sourceToolName && event.status === 'running')
    : undefined
  const sourceToolCall = sourceState.runId === context.runId
    ? sourceState.toolCalls.findLast(call => call.toolName === sourceToolName && call.status === 'running')
    : undefined
  if (request.placement === 'response' && (request.mode !== 'display'
    || !sourceState.isRunning || sourceState.runId !== context.runId
    || sourceState.activeChatId !== target.chatId || !sourceTrace || !sourceToolCall)) {
    return { status: 'cancelled' }
  }
  if (request.placement === 'response') {
    const sources = getChatResponseSources(sourceState.ragSourceDetails)
    const artifacts = getAgentArtifactPaths({ toolCalls: sourceState.toolCalls })
    validateChatResponseReferences(request.spec, new Set(sources.map(source => source.sourceKey)), new Set(Object.keys(artifacts.paths)))
    await Promise.all(getChatResponseNotePaths(request.spec).map(path => verifyResponseNote(path)))
  }
  const block: ChatUiBlock = {
    ...request,
    version: 1,
    id: crypto.randomUUID(),
    runId: context.runId,
    traceEventId: sourceTrace?.id,
    toolCallId: sourceToolCall?.id,
    workspaceIdentity,
    workspaceFingerprint: await fingerprintWorkspaceIdentity(workspaceIdentity),
    status: request.mode === 'display' ? 'displayed' : 'pending',
    state: getChatUiInitialValues(request.spec),
    createdAt: Date.now(),
  }
  await persistBlock(target.chatId, block)
  const activeState = useChatStore.getState().agentState
  if (context.signal?.aborted
    || revision !== interactionRevision
    || useSettingStore.getState().workspacePath !== workspacePath
    || !activeState.isRunning
    || activeState.runId !== context.runId
    || activeState.activeChatId !== target.chatId) {
    try {
      await persistBlock(target.chatId, { ...block, status: 'cancelled' })
    } catch (error) {
      // Even a full or deleted message must not turn cancellation into a retryable tool failure.
      console.error('Unable to persist cancelled conversation UI', error)
    }
    return { status: 'cancelled' }
  }
  if (request.mode === 'display') return { status: 'displayed' }

  let resolveResult: (response: ChatUiResponse) => void = () => undefined
  const result = new Promise<ChatUiResponse>(resolve => { resolveResult = resolve })
  const interaction: ActiveInteraction = {
    ...target,
    block,
    signal: context.signal,
    workspacePath,
    claimed: false,
    cancelled: false,
    settled: false,
    resolve: resolveResult,
    result,
    cleanup: () => undefined,
  }
  activeInteractions.set(block.id, interaction)
  const store = useChatStore.getState()
  store.setAgentState({
    pendingUiInteraction: {
      id: block.id,
      chatId: target.chatId,
      conversationId: target.conversationId,
      runId: block.runId,
      workspaceIdentity,
    },
    status: 'waiting_answer',
    isThinking: false,
  })

  const unsubscribeChat = useChatStore.subscribe(() => {
    if (!isActive(interaction)) void cancel(interaction)
  })
  const unsubscribeSettings = useSettingStore.subscribe(state => {
    if (state.workspacePath !== workspacePath) void cancel(interaction)
  })
  const abort = () => { void cancel(interaction) }
  context.signal?.addEventListener('abort', abort, { once: true })
  interaction.cleanup = () => {
    unsubscribeChat()
    unsubscribeSettings()
    context.signal?.removeEventListener('abort', abort)
  }
  if (!isActive(interaction)) void cancel(interaction)
  return result
}

export async function submitChatUiInteraction(
  id: string,
  values: ChatUiValues,
): Promise<{ success: boolean; errors?: Record<string, string> }> {
  const interaction = activeInteractions.get(id)
  if (!interaction || interaction.claimed || !isActive(interaction, true)) {
    return { success: false, errors: { _form: 'expired' } }
  }
  interaction.claimed = true
  const fail = async (errors: Record<string, string>) => {
    interaction.claimed = false
    if (interaction.cancelled || !isActive(interaction)) await cancel(interaction)
    return { success: false, errors }
  }
  try {
    if (!await hasSameWorkspace(interaction)) {
      interaction.cancelled = true
      return await fail({ _form: 'expired' })
    }
    const validated = validateChatUiValues(interaction.block.spec, values)
    if (!validated.success) return await fail(validated.errors)
    const domainErrors = await validateChatUiDomainValues(interaction.block.spec, validated.values)
    if (Object.keys(domainErrors).length) return await fail(domainErrors)
    if (!isActive(interaction, true) || !await hasSameWorkspace(interaction)) {
      interaction.cancelled = true
      return await fail({ _form: 'expired' })
    }
    const submitted: ChatUiBlock = {
      ...interaction.block,
      status: 'submitted',
      state: validated.values,
      submittedValues: validated.values,
    }
    await persistBlock(interaction.chatId, submitted)
    if (interaction.cancelled || !isActive(interaction) || !await hasSameWorkspace(interaction)) {
      interaction.block = { ...submitted, status: 'cancelled', submittedValues: undefined }
      await persistBlock(interaction.chatId, interaction.block)
      finish(interaction, { status: 'cancelled' })
      return { success: false, errors: { _form: 'expired' } }
    }
    interaction.block = submitted
    finish(interaction, { status: 'submitted', values: validated.values })
    return { success: true }
  } catch {
    return await fail({ _form: 'saveFailed' })
  }
}

/** Keep unfinished input in this run when its saved conversation is temporarily hidden. */
export function getChatUiInteractionDraft(id: string): ChatUiValues | undefined {
  const interaction = activeInteractions.get(id)
  return interaction && isActive(interaction) ? { ...interaction.block.state } : undefined
}

export function updateChatUiInteractionDraft(id: string, values: ChatUiValues): void {
  const interaction = activeInteractions.get(id)
  if (!interaction || interaction.claimed || !isActive(interaction, true)) return
  const validated = validateChatUiValues(interaction.block.spec, values, false)
  if (validated.success) interaction.block = { ...interaction.block, state: validated.values }
}

export async function cancelChatUiInteraction(id: string): Promise<void> {
  const interaction = activeInteractions.get(id)
  if (!interaction || !isActive(interaction, true)) return
  await cancel(interaction)
}
