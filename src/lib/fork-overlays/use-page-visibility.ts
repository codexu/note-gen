import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import useThreadsStore from '@/stores/threads'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useWeekOverlay } from '@/lib/week/overlay'

export function usePageVisibility() {
  const home = useHomeStore(state => state.visible)
  const decide = useDecideStore(state => state.visible)
  const collect = useCollectStore(state => state.visible)
  const inbox = useInboxStore(state => state.visible)
  const threads = useThreadsStore(state => state.visible)
  const week = useWeekOverlay(state => state.visible)
  const knowledge = useKnowledgeOverlay(state => state.visible)
  const promptLibrary = usePromptLibraryStore(state => state.visible)
  return { home, decide, collect, inbox, threads, week, knowledge, promptLibrary }
}
