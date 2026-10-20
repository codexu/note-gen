import type { AgentSteeringPayload } from './types'
import { PendingMessageQueue } from './pending-message-queue'

export type AgentStreamingBehavior = 'steer' | 'followUp'

export interface AgentPendingMessage<TRequest> {
  id: string
  behavior: AgentStreamingBehavior
  request: TRequest
}

export type AgentSessionEvent =
  | { type: 'queue_changed'; steering: number; followUp: number; pending: number }
  | { type: 'streaming_changed'; isStreaming: boolean }

export interface AgentSessionRunner {
  steer: (payload: AgentSteeringPayload) => boolean
  clearSteeringQueue: () => void
  removeSteering: (sequence: number) => void
  stop: () => void
}

interface AgentSessionDriver<TRequest> {
  execute: (request: TRequest) => Promise<void>
  prepareSteering: (request: TRequest, sequence: number) => Promise<AgentSteeringPayload>
  onSteeringError?: (error: unknown) => void
}

interface PendingSteering<TRequest> {
  generation: number
  request: TRequest
  payload: AgentSteeringPayload
}

interface SteeringRequest<TRequest> {
  id: string
  request: TRequest
  generation: number
}

interface FollowUpRequest<TRequest> {
  id: string
  request: TRequest
}

/**
 * Owns the lifecycle and message queues above a single Agent runner.
 *
 * The controller intentionally has no React or store dependency. UI layers
 * subscribe to session events, while an application driver handles persistence
 * and context preparation.
 */
export class AgentSessionController<TRequest> {
  private driver: AgentSessionDriver<TRequest> | null = null
  private readonly followUpQueue = new PendingMessageQueue<FollowUpRequest<TRequest>>('one-at-a-time')
  private readonly steeringRequests = new Map<number, SteeringRequest<TRequest>>()
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>()
  private activeRunner: AgentSessionRunner | null = null
  private activeRun: Promise<void> | null = null
  private pendingSteering: PendingSteering<TRequest>[] = []
  private steeringChain = Promise.resolve()
  private streaming = false
  private stopRequested = false
  private generation = 0
  private steeringSequence = 0
  private pendingMessageSequence = 0

  configure(driver: AgentSessionDriver<TRequest>) {
    this.driver = driver
  }

  subscribe(listener: (event: AgentSessionEvent) => void) {
    this.listeners.add(listener)
    listener({ type: 'queue_changed', ...this.getQueueCounts() })
    listener({ type: 'streaming_changed', isStreaming: this.streaming })
    return () => {
      this.listeners.delete(listener)
    }
  }

  get isStreaming() {
    return this.streaming
  }

  get pendingMessages(): AgentPendingMessage<TRequest>[] {
    const steering = [...this.steeringRequests.values()].map(item => ({
      id: item.id,
      behavior: 'steer' as const,
      request: item.request,
    }))
    const followUp = this.followUpQueue.values().map(item => ({
      id: item.id,
      behavior: 'followUp' as const,
      request: item.request,
    }))
    return [...steering, ...followUp]
  }

  steerPendingMessage(id: string) {
    const followUp = this.followUpQueue.remove(item => item.id === id)
    if (!followUp) return false
    this.queueSteering(followUp.request, followUp.id)
    return true
  }

  updatePendingRequest(id: string, request: TRequest) {
    const updated = this.followUpQueue.update(
      item => item.id === id,
      item => ({ ...item, request })
    )
    if (updated) this.emitQueueChanged()
    return updated
  }

  reorderFollowUps(ids: string[]) {
    this.followUpQueue.reorder(ids, item => item.id)
    this.emitQueueChanged()
  }

  removePendingMessage(id: string) {
    const steering = [...this.steeringRequests.entries()].find(([, item]) => item.id === id)
    if (steering) {
      const [sequence] = steering
      this.steeringRequests.delete(sequence)
      this.pendingSteering = this.pendingSteering.filter(entry => entry.payload.sequence !== sequence)
      this.activeRunner?.removeSteering(sequence)
      this.emitQueueChanged()
      return true
    }

    const removed = this.followUpQueue.remove(item => item.id === id)
    if (removed) this.emitQueueChanged()
    return Boolean(removed)
  }

  setActiveRunner(runner: AgentSessionRunner | null) {
    this.activeRunner = runner
    if (!runner) return

    const deliverable = this.pendingSteering.filter(item => item.generation === this.generation)
    this.pendingSteering = this.pendingSteering.filter(item => item.generation !== this.generation)
    for (const item of deliverable) {
      if (!runner.steer(item.payload)) {
        this.pendingSteering.push(item)
      }
    }
  }

  async prompt(request: TRequest, options?: { streamingBehavior?: AgentStreamingBehavior }) {
    this.getDriver()

    if (this.streaming) {
      if (!options?.streamingBehavior) {
        throw new Error('Agent is already processing. Specify steer or followUp to queue the message.')
      }

      if (options.streamingBehavior === 'followUp') {
        this.enqueueFollowUp(request)
      } else {
        this.queueSteering(request)
      }
      return
    }

    this.streaming = true
    this.stopRequested = false
    this.emit({ type: 'streaming_changed', isStreaming: true })
    const run = this.runRequests(request)
    this.activeRun = run

    try {
      await run
    } finally {
      if (this.activeRun === run) {
        this.activeRun = null
      }
    }
  }

  waitForIdle() {
    return this.activeRun ?? Promise.resolve()
  }

  acknowledgeSteering(sequences: number[]) {
    let changed = false
    for (const sequence of sequences) {
      changed = this.steeringRequests.delete(sequence) || changed
    }
    if (changed) this.emitQueueChanged()
  }

  clearQueues() {
    const pending = this.pendingMessages
    this.steeringRequests.clear()
    this.pendingSteering = []
    this.followUpQueue.clear()
    this.activeRunner?.clearSteeringQueue()
    this.emitQueueChanged()
    return pending
  }

  abort() {
    this.stopRequested = true
    this.clearQueues()
    this.activeRunner?.stop()
  }

  dispose() {
    this.abort()
    this.driver = null
    this.listeners.clear()
  }

  private async runRequests(initialRequest: TRequest) {
    let nextRequest: TRequest | undefined = initialRequest

    try {
      while (nextRequest !== undefined && !this.stopRequested) {
        this.generation += 1
        await this.getDriver().execute(nextRequest)
        await this.steeringChain
        this.requeueUnacknowledgedSteering()
        nextRequest = this.followUpQueue.drain()[0]?.request
        this.emitQueueChanged()
      }
    } finally {
      this.activeRunner = null
      this.pendingSteering = []
      this.streaming = false
      this.emit({ type: 'streaming_changed', isStreaming: false })
    }
  }

  private queueSteering(request: TRequest, id = this.createPendingMessageId()) {
    const driver = this.getDriver()
    const generation = this.generation
    const sequence = ++this.steeringSequence
    this.steeringRequests.set(sequence, { id, request, generation })
    this.emitQueueChanged()

    this.steeringChain = this.steeringChain.then(async () => {
      if (this.stopRequested || !this.steeringRequests.has(sequence)) return
      let payload: AgentSteeringPayload
      try {
        payload = await driver.prepareSteering(request, sequence)
      } catch (error) {
        if (!this.stopRequested && this.steeringRequests.has(sequence)) {
          driver.onSteeringError?.(error)
          this.moveSteeringToFollowUp(sequence, request)
        }
        return
      }
      if (this.stopRequested || !this.steeringRequests.has(sequence)) return

      if (!this.streaming || generation !== this.generation) {
        this.moveSteeringToFollowUp(sequence, request)
        return
      }

      if (this.activeRunner?.steer(payload)) return
      this.pendingSteering.push({ generation, request, payload })
    })
  }

  private requeueUnacknowledgedSteering() {
    this.pendingSteering = this.pendingSteering.filter(item => item.generation !== this.generation)
    const unacknowledged = [...this.steeringRequests.entries()]
      .filter(([, item]) => item.generation === this.generation)
    for (const [sequence, item] of unacknowledged) {
      this.moveSteeringToFollowUp(sequence, item.request)
    }
  }

  private moveSteeringToFollowUp(sequence: number, request: TRequest) {
    const steering = this.steeringRequests.get(sequence)
    this.steeringRequests.delete(sequence)
    this.followUpQueue.enqueue({
      id: steering?.id ?? this.createPendingMessageId(),
      request,
    })
    this.emitQueueChanged()
  }

  private enqueueFollowUp(request: TRequest, id = this.createPendingMessageId()) {
    this.followUpQueue.enqueue({ id, request })
    this.emitQueueChanged()
  }

  private createPendingMessageId() {
    this.pendingMessageSequence += 1
    return `pending-${this.pendingMessageSequence}`
  }

  private getQueueCounts() {
    const steering = this.steeringRequests.size
    const followUp = this.followUpQueue.size
    return { steering, followUp, pending: steering + followUp }
  }

  private emitQueueChanged() {
    this.emit({ type: 'queue_changed', ...this.getQueueCounts() })
  }

  private emit(event: AgentSessionEvent) {
    for (const listener of this.listeners) listener(event)
  }

  private getDriver() {
    if (!this.driver) throw new Error('Agent session driver is not configured.')
    return this.driver
  }
}
