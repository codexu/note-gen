import * as React from "react"
import { AgentPlan } from "@/components/ui/agent-plan"

interface AgentHistoryProps {
  historyJson: string
}

/**
 * Agent history component - displays saved agent execution history
 * This component now uses the unified AgentPlan component for consistent styling
 */
export function AgentHistory({ historyJson }: AgentHistoryProps) {
  return (
    <AgentPlan
      mode="history"
      historyJson={historyJson}
    />
  )
}
