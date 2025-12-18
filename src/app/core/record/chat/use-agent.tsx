import { useState, useCallback, useRef } from 'react'
import { AgentHandler } from '@/lib/agent/agent-handler'
import useChatStore from '@/stores/chat'

export function useAgent() {
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    toolName: string
    params: Record<string, any>
    resolve: (value: boolean) => void
  } | null>(null)
  
  const agentRef = useRef<AgentHandler | null>(null)
  const { chatMode } = useChatStore()

  const requestConfirmation = useCallback(
    (toolName: string, params: Record<string, any>): Promise<boolean> => {
      return new Promise((resolve) => {
        setPendingConfirmation({ toolName, params, resolve })
        setIsConfirmationOpen(true)
      })
    },
    []
  )

  const handleConfirm = useCallback(() => {
    if (pendingConfirmation) {
      pendingConfirmation.resolve(true)
      setPendingConfirmation(null)
      setIsConfirmationOpen(false)
    }
  }, [pendingConfirmation])

  const handleCancel = useCallback(() => {
    if (pendingConfirmation) {
      pendingConfirmation.resolve(false)
      setPendingConfirmation(null)
      setIsConfirmationOpen(false)
    }
  }, [pendingConfirmation])

  const executeAgent = useCallback(
    async (userInput: string, context?: string): Promise<string> => {
      if (chatMode !== 'agent') {
        throw new Error('Not in agent mode')
      }

      if (!agentRef.current) {
        agentRef.current = new AgentHandler({
          requestConfirmation,
          onThought: (thought) => {
            console.log('Thought:', thought)
          },
          onAction: (action, params) => {
            console.log('Action:', action, params)
          },
          onObservation: (observation) => {
            console.log('Observation:', observation)
          },
          onComplete: (result) => {
            console.log('Complete:', result)
          },
          onError: (error) => {
            console.error('Error:', error)
          },
        })
      }

      return await agentRef.current.execute(userInput, context)
    },
    [chatMode, requestConfirmation]
  )

  const stopAgent = useCallback(() => {
    if (agentRef.current) {
      agentRef.current.stop()
      agentRef.current = null
    }
  }, [])

  return {
    executeAgent,
    stopAgent,
    isConfirmationOpen,
    pendingConfirmation,
    handleConfirm,
    handleCancel,
  }
}
