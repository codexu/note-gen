export const ONBOARDING_STEP_ORDER = ['create-record', 'organize-note', 'ai-polish'] as const
export type OnboardingStepId = typeof ONBOARDING_STEP_ORDER[number]

export interface OnboardingProgress {
  steps: Record<OnboardingStepId, boolean>
  workspaceId: string | null
  recordId: number | null
  notePath: string | null
}

export function createDefaultOnboardingProgress(): OnboardingProgress {
  return {
    steps: {
      'create-record': false,
      'organize-note': false,
      'ai-polish': false,
    },
    workspaceId: null,
    recordId: null,
    notePath: null,
  }
}

export function normalizeOnboardingNotePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.replace(/\\/g, '/')
  if (/^[a-z]:|^\//i.test(path) || !/\.md$/i.test(path)) return null
  if (path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null
  return path
}

export function normalizeOnboardingProgress(value: unknown): OnboardingProgress {
  if (!value || typeof value !== 'object') return createDefaultOnboardingProgress()

  const candidate = value as Partial<OnboardingProgress>
  return {
    steps: {
      'create-record': candidate.steps?.['create-record'] === true,
      'organize-note': candidate.steps?.['organize-note'] === true,
      'ai-polish': candidate.steps?.['ai-polish'] === true,
    },
    workspaceId: typeof candidate.workspaceId === 'string' && candidate.workspaceId
      ? candidate.workspaceId
      : null,
    recordId: typeof candidate.recordId === 'number' && Number.isSafeInteger(candidate.recordId) && candidate.recordId > 0
      ? candidate.recordId
      : null,
    notePath: normalizeOnboardingNotePath(candidate.notePath),
  }
}

export function getActiveOnboardingStep(progress: OnboardingProgress): OnboardingStepId | null {
  return ONBOARDING_STEP_ORDER.find(step => !progress.steps[step]) ?? null
}
