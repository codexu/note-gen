const MAX_RETRIES = 2
const BASE_DELAY_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return message.includes('429') ||
    message.includes('529') ||
    message.includes('timeout') ||
    message.includes('temporarily') ||
    message.includes('rate limit')
}

export class AgentRecoveryManager {
  async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        if (attempt >= MAX_RETRIES || !shouldRetry(error)) {
          break
        }

        await delay(BASE_DELAY_MS * 2 ** attempt)
      }
    }

    throw lastError
  }
}
