export type OnboardingStepId = 'create-record' | 'organize-note' | 'ai-polish'
export type OnboardingCompletionFeedbackMode = 'inline' | 'dialog'

export interface OnboardingProgress {
  dismissed: boolean
  steps: Record<OnboardingStepId, boolean>
}

const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  'create-record',
  'organize-note',
  'ai-polish',
]

export function createDefaultOnboardingProgress(): OnboardingProgress {
  return {
    dismissed: false,
    steps: {
      'create-record': false,
      'organize-note': false,
      'ai-polish': false,
    },
  }
}

export function normalizeOnboardingProgress(value: unknown): OnboardingProgress {
  const defaults = createDefaultOnboardingProgress()

  if (!value || typeof value !== 'object') {
    return defaults
  }

  const candidate = value as Partial<OnboardingProgress>
  const candidateSteps = candidate.steps && typeof candidate.steps === 'object'
    ? candidate.steps as Partial<Record<OnboardingStepId, boolean>>
    : {}

  return {
    dismissed: candidate.dismissed === true,
    steps: {
      'create-record': candidateSteps['create-record'] === true,
      'organize-note': candidateSteps['organize-note'] === true,
      'ai-polish': candidateSteps['ai-polish'] === true,
    },
  }
}

export function markOnboardingStepDone(
  progress: OnboardingProgress,
  step: OnboardingStepId
): OnboardingProgress {
  return {
    ...progress,
    steps: {
      ...progress.steps,
      [step]: true,
    },
  }
}

export function getActiveOnboardingStep(progress: OnboardingProgress): OnboardingStepId | null {
  return ONBOARDING_STEP_ORDER.find((step) => !progress.steps[step]) ?? null
}

export function getNextOnboardingStep(
  progress: OnboardingProgress,
  completedStep: OnboardingStepId | null
): OnboardingStepId | null {
  if (completedStep) {
    return null
  }

  return getActiveOnboardingStep(progress)
}

export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  return ONBOARDING_STEP_ORDER.every((step) => progress.steps[step])
}

export function shouldShowOnboardingTasks(progress: OnboardingProgress): boolean {
  return !progress.dismissed && !isOnboardingComplete(progress)
}

export function getCompletionFeedbackMode(
  completedStep: OnboardingStepId,
  activeStep: OnboardingStepId | null
): OnboardingCompletionFeedbackMode {
  if (completedStep === 'organize-note' && activeStep === 'organize-note') {
    return 'dialog'
  }

  return 'inline'
}
