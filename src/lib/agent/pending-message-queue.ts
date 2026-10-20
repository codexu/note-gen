export type AgentQueueMode = 'all' | 'one-at-a-time'

export class PendingMessageQueue<T> {
  private messages: T[] = []

  constructor(
    public mode: AgentQueueMode = 'one-at-a-time',
    private readonly compare?: (left: T, right: T) => number
  ) {}

  enqueue(message: T) {
    this.messages.push(message)
    if (this.compare) {
      this.messages.sort(this.compare)
    }
  }

  drain() {
    if (this.mode === 'all') {
      const drained = this.messages.slice()
      this.messages = []
      return drained
    }

    const first = this.messages.shift()
    return first === undefined ? [] : [first]
  }

  clear() {
    const cleared = this.messages.slice()
    this.messages = []
    return cleared
  }

  remove(predicate: (message: T) => boolean) {
    const index = this.messages.findIndex(predicate)
    if (index === -1) return undefined
    return this.messages.splice(index, 1)[0]
  }

  update(predicate: (message: T) => boolean, updater: (message: T) => T) {
    const index = this.messages.findIndex(predicate)
    if (index === -1) return false
    this.messages[index] = updater(this.messages[index])
    return true
  }

  reorder(ids: string[], getId: (message: T) => string) {
    const positions = new Map(ids.map((id, index) => [id, index]))
    this.messages.sort((left, right) => {
      const leftPosition = positions.get(getId(left)) ?? Number.MAX_SAFE_INTEGER
      const rightPosition = positions.get(getId(right)) ?? Number.MAX_SAFE_INTEGER
      return leftPosition - rightPosition
    })
  }

  hasItems() {
    return this.messages.length > 0
  }

  get size() {
    return this.messages.length
  }

  values() {
    return this.messages.slice()
  }
}
