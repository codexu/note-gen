'use client'

type ViewportWork = () => void | Promise<void>

interface QueuedViewportWork {
  cancelled: boolean
  run: ViewportWork
}

export function createViewportWorkQueue() {
  const queue: QueuedViewportWork[] = []
  let frameId: number | null = null
  let isRunning = false

  const scheduleNext = () => {
    if (frameId !== null || isRunning) return

    while (queue[0]?.cancelled) queue.shift()
    const nextWork = queue.shift()
    if (!nextWork) return

    frameId = window.requestAnimationFrame(() => {
      frameId = null
      if (nextWork.cancelled) {
        scheduleNext()
        return
      }

      isRunning = true
      void Promise.resolve()
        .then(nextWork.run)
        .catch(() => undefined)
        .finally(() => {
          isRunning = false
          scheduleNext()
        })
    })
  }

  return (run: ViewportWork) => {
    const queuedWork: QueuedViewportWork = { cancelled: false, run }
    queue.push(queuedWork)
    scheduleNext()

    return () => {
      queuedWork.cancelled = true
    }
  }
}
