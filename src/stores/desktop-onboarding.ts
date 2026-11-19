import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import {
  createDefaultOnboardingProgress,
  getActiveOnboardingStep,
  normalizeOnboardingNotePath,
  normalizeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingStepId,
} from '@/app/core/main/editor/onboarding-state'
import { getWorkspacePath } from '@/lib/workspace'

type OnboardingAttemptBase = { id: string; workspaceId: string }
export type CreateRecordOnboardingAttempt = OnboardingAttemptBase & { step: 'create-record' }
export type OrganizeNoteOnboardingAttempt = OnboardingAttemptBase & { step: 'organize-note'; recordId: number }
export type AgentOnboardingAttempt = OnboardingAttemptBase & { step: 'ai-polish'; notePath: string }
type OnboardingAttempt = CreateRecordOnboardingAttempt | OrganizeNoteOnboardingAttempt | AgentOnboardingAttempt

interface DesktopOnboardingState {
  progress: OnboardingProgress | null
  welcomeRequested: boolean
  attempt: OnboardingAttempt | null
  recordRequest: { attempt: CreateRecordOnboardingAttempt; sampleText: string } | null
  organizeRequest: OrganizeNoteOnboardingAttempt | null
  completedStep: OnboardingStepId | null
  hydrate: () => Promise<void>
  setWelcomeRequested: (requested: boolean) => void
  beginRecord: (workspaceId: string, sampleText: string) => void
  beginOrganize: (workspaceId: string, recordId: number) => void
  beginAgent: (workspaceId: string, notePath: string) => void
  consumeRecordRequest: (id: string) => void
  consumeOrganizeRequest: (id: string) => void
  completeRecord: (id: string, recordId: number) => void
  completeOrganize: (id: string, notePath: string) => void
  completeAgent: (id: string) => void
  clearCompletion: () => void
  cancelAttempt: () => void
  reset: (step?: 'create-record' | 'organize-note') => void
  updateNotePath: (workspaceId: string, previousPath: string, nextPath: string | null) => void
}

const storeKey = 'desktopOnboardingProgress'
const idleAttempt = { attempt: null, recordRequest: null, organizeRequest: null, completedStep: null }
let hydration: Promise<void> | undefined
let persistence = Promise.resolve()

export async function getDesktopOnboardingWorkspaceIdentity(): Promise<string> {
  const { getSkillWorkspaceIdentity } = await import('@/lib/skills/runtime')
  return getSkillWorkspaceIdentity(await getWorkspacePath())
}

function persist(progress: OnboardingProgress) {
  persistence = persistence.then(async () => {
    const store = await Store.load('store.json')
    await store.set(storeKey, progress)
    await store.save()
  }).catch(error => console.error('Failed to save desktop onboarding:', error))
}

export const useDesktopOnboardingStore = create<DesktopOnboardingState>((set, get) => {
  function complete(id: string, step: OnboardingStepId, artifact: Partial<OnboardingProgress> = {}) {
    const { attempt, progress } = get()
    if (attempt?.id !== id || attempt.step !== step || !progress || getActiveOnboardingStep(progress) !== step) return
    const next = {
      ...progress,
      ...artifact,
      workspaceId: attempt.workspaceId,
      steps: { ...progress.steps, [step]: true },
    }
    set({ ...idleAttempt, progress: next, completedStep: step })
    persist(next)
  }

  return {
    progress: null,
    welcomeRequested: false,
    ...idleAttempt,
    hydrate: () => {
      hydration ??= (async () => {
        try {
          const store = await Store.load('store.json')
          set({ progress: normalizeOnboardingProgress(await store.get(storeKey)) })
        } catch (error) {
          console.error('Failed to load desktop onboarding:', error)
          set({ progress: createDefaultOnboardingProgress() })
        }
      })()
      return hydration
    },
    setWelcomeRequested: welcomeRequested => set({ welcomeRequested }),
    beginRecord: (workspaceId, sampleText) => {
      const attempt: CreateRecordOnboardingAttempt = { id: crypto.randomUUID(), step: 'create-record', workspaceId }
      set({ ...idleAttempt, attempt, recordRequest: { attempt, sampleText } })
    },
    beginOrganize: (workspaceId, recordId) => {
      const attempt: OrganizeNoteOnboardingAttempt = { id: crypto.randomUUID(), step: 'organize-note', workspaceId, recordId }
      set({ ...idleAttempt, attempt, organizeRequest: attempt })
    },
    beginAgent: (workspaceId, notePath) => {
      const attempt: AgentOnboardingAttempt = { id: crypto.randomUUID(), step: 'ai-polish', workspaceId, notePath }
      set({ ...idleAttempt, attempt })
    },
    consumeRecordRequest: id => {
      if (get().recordRequest?.attempt.id === id) set({ recordRequest: null })
    },
    consumeOrganizeRequest: id => {
      if (get().organizeRequest?.id === id) set({ organizeRequest: null })
    },
    completeRecord: (id, recordId) => {
      if (Number.isSafeInteger(recordId) && recordId > 0) complete(id, 'create-record', { recordId })
    },
    completeOrganize: (id, path) => {
      const notePath = normalizeOnboardingNotePath(path)
      if (notePath) complete(id, 'organize-note', { notePath })
    },
    completeAgent: id => complete(id, 'ai-polish'),
    clearCompletion: () => set({ completedStep: null }),
    cancelAttempt: () => set(idleAttempt),
    reset: (step = 'create-record') => {
      const { progress } = get()
      if (!progress) return
      const next = step === 'organize-note' ? {
        ...progress,
        steps: { ...progress.steps, 'organize-note': false, 'ai-polish': false },
        notePath: null,
      } : createDefaultOnboardingProgress()
      set({ ...idleAttempt, progress: next })
      persist(next)
    },
    updateNotePath: (workspaceId, previousPath, nextPath) => {
      const { progress, attempt } = get()
      if (!progress || progress.workspaceId !== workspaceId || progress.notePath !== previousPath) return
      const notePath = normalizeOnboardingNotePath(nextPath)
      if (progress.notePath === notePath) return
      const next = { ...progress, notePath }
      set(attempt?.step === 'ai-polish' ? { ...idleAttempt, progress: next } : { progress: next })
      persist(next)
    },
  }
})
