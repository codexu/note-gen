'use client'

// Fork（almanac ALMNC-10）：訂閱兩個來源與今日日誌快取，回傳投影後的清單。首頁、側欄、等你定頁都用這一個。
import { useMemo } from 'react'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import { projectDecisions, type DecideItem } from './project'

const NONE: DecideItem[] = []

/** 舊介面（classic）一律回空：等你定的入口與擴充都不出現。 */
export function useDecisions(): DecideItem[] {
  const isV3 = useUiV3()
  const items = useCollectStore(state => state.items)
  const tasks = useAgentTaskStore(state => state.tasks)
  const journal = useDecideStore(state => state.journal)
  return useMemo(() => (isV3 ? projectDecisions({ items, tasks, journal }) : NONE), [isV3, items, tasks, journal])
}
