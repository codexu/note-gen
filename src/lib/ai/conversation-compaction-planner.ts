export type CompactionChatLike = {
  id: number
  role: string
  type: string
  content?: string | null
}

export type CompactionTurn<T extends CompactionChatLike> = {
  chats: T[]
  tokenCount: number
}

export function getCompletedConversationHistory<T extends CompactionChatLike>(chats: T[]) {
  const lastClearIndex = chats.findLastIndex(chat => chat.type === 'clear')
  const active = lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)
  const currentUserIndex = active.findLastIndex(chat => chat.role === 'user')
  if (currentUserIndex === -1) {
    return active
  }

  const hasCompletedReply = active
    .slice(currentUserIndex + 1)
    .some(chat =>
      (chat.type === 'chat' || chat.type === 'note')
      && chat.role !== 'user'
      && Boolean(chat.content?.trim())
    )

  return hasCompletedReply ? active : active.slice(0, currentUserIndex)
}

export function buildConversationTurns<T extends CompactionChatLike>(
  chats: T[],
  estimate: (content: string) => number
) {
  const turns: CompactionTurn<T>[] = []
  let current: T[] = []

  const append = () => {
    if (current.length === 0) {
      return
    }
    turns.push({
      chats: current,
      tokenCount: current.reduce((sum, item) => sum + estimate(item.content || ''), 0),
    })
  }

  for (const chat of chats) {
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    if (chat.role === 'user') {
      append()
      current = [chat]
      continue
    }

    if (current.length > 0) {
      current.push(chat)
    }
  }

  append()
  return turns
}

export function selectRecentConversationTurns<T extends CompactionChatLike>(
  turns: CompactionTurn<T>[],
  keepLatestCount: number,
  budget: number
) {
  const selected: CompactionTurn<T>[] = []
  let total = 0

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (selected.length >= keepLatestCount) {
      break
    }

    if (selected.length > 0 && total + turn.tokenCount > budget) {
      break
    }

    selected.unshift(turn)
    total += turn.tokenCount
  }

  return selected
}

export function splitConversationTurnBatches<T extends CompactionChatLike>(
  turns: CompactionTurn<T>[],
  tokenBudget: number
) {
  const batches: CompactionTurn<T>[][] = []
  let current: CompactionTurn<T>[] = []
  let total = 0

  for (const turn of turns) {
    if (current.length > 0 && total + turn.tokenCount > tokenBudget) {
      batches.push(current)
      current = []
      total = 0
    }

    current.push(turn)
    total += turn.tokenCount
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}
