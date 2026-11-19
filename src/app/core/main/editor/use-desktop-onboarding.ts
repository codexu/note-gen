'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { getMarkById } from '@/db/marks'
import emitter from '@/lib/emitter'
import {
  editorPathIsSameOrDescendant, editorPathsReferToSameFile, getCurrentEditorWorkspaceRoot,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'
import { showRecordSidebar } from '@/lib/record-navigation'
import { usePluginUiStore } from '@/lib/plugins/ui-registry'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import { getDesktopOnboardingWorkspaceIdentity, useDesktopOnboardingStore } from '@/stores/desktop-onboarding'
import { useInitialSetupStore } from '@/stores/initial-setup'
import useSettingStore from '@/stores/setting'
import { collectGroupedChatModels, findGroupedChatModel } from '../chat/model-selection'
import { getActiveOnboardingStep, type OnboardingProgress } from './onboarding-state'

type RecoveryStep = 'create-record' | 'organize-note'

async function getRecoveryStep(progress: OnboardingProgress): Promise<RecoveryStep | null> {
  const step = getActiveOnboardingStep(progress)
  if (!step || step === 'create-record') return null
  if (step === 'ai-polish' && progress.notePath) {
    const { path, baseDir } = await getFilePathOptions(progress.notePath)
    if (await exists(path, { baseDir })) return null
  }
  const record = progress.recordId ? await getMarkById(progress.recordId) : null
  if (!record || record.deleted) return 'create-record'
  return step === 'ai-polish' ? 'organize-note' : null
}

function hasUsableModel() {
  const { aiModelList, primaryModel } = useSettingStore.getState()
  return Boolean(findGroupedChatModel(collectGroupedChatModels(aiModelList), primaryModel))
}

export function useDesktopOnboarding({
  ready,
  revealChecklist,
  revealRecordPanel,
  revealAgentPanel,
}: {
  ready: boolean
  revealChecklist: () => Promise<boolean>
  revealRecordPanel: () => Promise<void>
  revealAgentPanel: () => Promise<void>
}) {
  const t = useTranslations('article.emptyState.onboarding')
  const progress = useDesktopOnboardingStore(state => state.progress)
  const welcomeRequested = useDesktopOnboardingStore(state => state.welcomeRequested)
  const attempt = useDesktopOnboardingStore(state => state.attempt)
  const pendingTriggerId = useDesktopOnboardingStore(state =>
    state.recordRequest?.attempt.id ?? state.organizeRequest?.id,
  )
  const completedStep = useDesktopOnboardingStore(state => state.completedStep)
  const settingsPath = useSettingStore(state => state.workspacePath)
  const modelConfigured = useSettingStore(state => Boolean(
    findGroupedChatModel(collectGroupedChatModels(state.aiModelList), state.primaryModel),
  ))
  const setupVisible = useInitialSetupStore(state => state.visible)
  const [resolvedWorkspace, setResolvedWorkspace] = useState<{ settingsPath: string; id: string; root: string } | null>(null)
  const [recovery, setRecovery] = useState<{ progress: OnboardingProgress; step: RecoveryStep | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [hintAttemptId, setHintAttemptId] = useState<string | null>(null)
  const operation = useRef(0)
  const busyRef = useRef(false)

  const workspace = resolvedWorkspace?.settingsPath === settingsPath ? resolvedWorkspace : null
  const workspaceId = workspace?.id ?? null
  const currentStep = progress && getActiveOnboardingStep(progress)
  const workspaceMismatch = Boolean(currentStep && progress?.workspaceId && workspaceId && progress.workspaceId !== workspaceId)
  const recoveryStep = recovery && recovery.progress === progress ? recovery.step : null
  const needsModel = Boolean(currentStep && currentStep !== 'create-record' && !modelConfigured)

  useEffect(() => {
    void useDesktopOnboardingStore.getState().hydrate()
  }, [])

  useEffect(() => {
    let disposed = false
    const cancelOnWorkspaceChange = useSettingStore.subscribe((state, previous) => {
      if (state.workspacePath !== previous.workspacePath) {
        useDesktopOnboardingStore.getState().cancelAttempt()
        operation.current += 1
        busyRef.current = false
        setBusy(false)
      }
    })
    void Promise.all([getDesktopOnboardingWorkspaceIdentity(), getCurrentEditorWorkspaceRoot()]).then(([id, root]) => {
      if (disposed) return
      setResolvedWorkspace({ settingsPath, id, root })
    }).catch(error => {
      console.error('Failed to resolve desktop onboarding workspace:', error)
    })
    return () => {
      disposed = true
      cancelOnWorkspaceChange()
    }
  }, [settingsPath])

  useEffect(() => {
    if (!progress || !workspaceId || workspaceMismatch) return
    let disposed = false
    void getRecoveryStep(progress).then(step => {
      if (!disposed) setRecovery({ progress, step })
    }).catch(error => {
      console.error('Failed to validate desktop onboarding artifacts:', error)
    })
    return () => { disposed = true }
  }, [progress, workspaceId, workspaceMismatch])

  useEffect(() => {
    if (!workspace) return
    const onPathMoved = ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
      if (useSettingStore.getState().workspacePath !== workspace.settingsPath) return
      const store = useDesktopOnboardingStore.getState()
      const path = store.progress?.notePath
      if (!path) return
      if (path === oldPath) store.updateNotePath(workspace.id, path, newPath)
      else if (path.startsWith(`${oldPath}/`)) {
        store.updateNotePath(workspace.id, path, `${newPath}${path.slice(oldPath.length)}`)
      }
    }
    const onPathDeleted = ({ path, isFolder, workspaceRoot }: { path: string; isFolder: boolean; workspaceRoot?: string }) => {
      if (useSettingStore.getState().workspacePath !== workspace.settingsPath) return
      if (workspaceRoot && !workspaceRootsReferToSameLocation(workspaceRoot, workspace.root)) return
      const store = useDesktopOnboardingStore.getState()
      const notePath = store.progress?.notePath
      if (!notePath) return
      const matches = isFolder
        ? editorPathIsSameOrDescendant(notePath, path, workspace.root)
        : editorPathsReferToSameFile(notePath, path, workspace.root)
      if (matches) store.updateNotePath(workspace.id, notePath, null)
    }
    emitter.on('editor-navigation-path-moved', onPathMoved)
    emitter.on('editor-navigation-path-deleted', onPathDeleted)
    return () => {
      emitter.off('editor-navigation-path-moved', onPathMoved)
      emitter.off('editor-navigation-path-deleted', onPathDeleted)
    }
  }, [workspace])

  useEffect(() => {
    if (completedStep !== 'create-record') return
    useDesktopOnboardingStore.getState().clearCompletion()
    void revealRecordPanel().catch(error => {
      console.error('Failed to expand the records sidebar:', error)
    })
  }, [completedStep, revealRecordPanel])

  useEffect(() => {
    if (!completedStep || !progress || currentStep) return
    toast.success(t('allDone'))
    useDesktopOnboardingStore.getState().clearCompletion()
  }, [completedStep, currentStep, progress, t])

  const reset = useCallback(() => {
    operation.current += 1
    busyRef.current = false
    setBusy(false)
    setHintAttemptId(null)
    useDesktopOnboardingStore.getState().reset()
  }, [])

  const dismissHint = useCallback((reason: 'close' | 'target') => {
    setHintAttemptId(current => current === hintAttemptId ? null : current)
    if (reason === 'close') {
      const store = useDesktopOnboardingStore.getState()
      if (store.attempt?.id === hintAttemptId && (store.recordRequest || store.organizeRequest)) {
        store.cancelAttempt()
      }
    }
  }, [hintAttemptId])

  const startCurrentStep = useCallback(async () => {
    if (busyRef.current) return
    const store = useDesktopOnboardingStore.getState()
    let progress = store.progress
    if (!progress || !getActiveOnboardingStep(progress)) return

    const sequence = ++operation.current
    const stillCurrent = () => sequence === operation.current
      && useSettingStore.getState().workspacePath === settingsPath
    busyRef.current = true
    setBusy(true)
    setHintAttemptId(null)
    store.clearCompletion()

    try {
      const workspace = await getDesktopOnboardingWorkspaceIdentity()
      if (!stillCurrent()) return

      if (progress.workspaceId && progress.workspaceId !== workspace) {
        store.reset()
      } else {
        const repair = await getRecoveryStep(progress)
        if (!stillCurrent() || useDesktopOnboardingStore.getState().progress !== progress) return
        if (repair) store.reset(repair)
      }

      progress = useDesktopOnboardingStore.getState().progress
      if (!progress) return
      const step = getActiveOnboardingStep(progress)
      if (!step) return

      if (step === 'create-record') {
        store.beginRecord(workspace, t('sampleRecord'))
        setHintAttemptId(useDesktopOnboardingStore.getState().attempt?.id ?? null)
        return
      }

      if (!hasUsableModel()) {
        await useInitialSetupStore.getState().openStep('model')
        return
      }

      if (step === 'organize-note' && progress.recordId) {
        showRecordSidebar()
        await revealRecordPanel()
        if (!stillCurrent() || useDesktopOnboardingStore.getState().progress !== progress) return
        store.beginOrganize(workspace, progress.recordId)
        setHintAttemptId(useDesktopOnboardingStore.getState().attempt?.id ?? null)
        return
      }

      if (step === 'ai-polish' && progress.notePath) {
        const notePath = progress.notePath
        const { path, baseDir } = await getFilePathOptions(notePath)
        const practiceContent = await readTextFile(path, { baseDir })
        if (!stillCurrent() || useDesktopOnboardingStore.getState().progress !== progress) return
        if (!practiceContent.trim()) {
          store.updateNotePath(workspace, notePath, null)
          toast.error(t('artifactMissing'))
          return
        }

        const article = useArticleStore.getState()
        if (article.activeFilePath !== notePath) {
          await article.setActiveFilePath(notePath, false, { createIfMissing: false })
        }
        const openedArticle = useArticleStore.getState()
        if (openedArticle.activeFilePath !== notePath) {
          toast.error(t('openPracticeFailed'))
          return
        }
        if (openedArticle.loading) {
          await openedArticle.readArticle(notePath, undefined, false, { createIfMissing: false })
        }
        if (!stillCurrent() || useDesktopOnboardingStore.getState().progress !== progress) return
        if (useArticleStore.getState().activeFilePath !== notePath) return

        await revealAgentPanel()
        if (!stillCurrent() || useDesktopOnboardingStore.getState().progress !== progress) return
        if (useArticleStore.getState().activeFilePath !== notePath) return
        usePluginUiStore.getState().setActiveRightView(null)
        store.beginAgent(workspace, notePath)
        setHintAttemptId(useDesktopOnboardingStore.getState().attempt?.id ?? null)
      }
    } catch (error) {
      if (!stillCurrent()) return
      console.error('Failed to start desktop onboarding step:', error)
      toast.error(t('openPracticeFailed'))
    } finally {
      if (stillCurrent()) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }, [revealAgentPanel, revealRecordPanel, settingsPath, t])

  useEffect(() => {
    if (!ready || !progress || !workspaceId || !welcomeRequested || setupVisible) return
    useDesktopOnboardingStore.getState().setWelcomeRequested(false)
    void (async () => {
      const revealed = await revealChecklist()
      if (!revealed) {
        toast.error(t('openPracticeFailed'))
        return
      }
      if (getActiveOnboardingStep(progress) === 'create-record' && !workspaceMismatch) {
        await startCurrentStep()
      }
    })().catch(error => {
      console.error('Failed to open desktop onboarding:', error)
      toast.error(t('openPracticeFailed'))
    })
  }, [progress, ready, revealChecklist, setupVisible, startCurrentStep, t, welcomeRequested, workspaceId, workspaceMismatch])

  const actionLabel = !currentStep ? ''
    : workspaceMismatch ? t('restartInWorkspace')
    : recoveryStep === 'create-record' ? t('recreateRecord')
    : recoveryStep === 'organize-note' ? t('recreateNote')
    : needsModel ? t('configureModel')
    : currentStep === 'create-record' ? t('start')
    : t('continue')

  const notice = workspaceMismatch ? t('workspaceMismatch')
    : recoveryStep ? t('artifactMissing')
    : needsModel ? t('modelRequired')
    : undefined
  const hintedStep = !setupVisible && attempt && attempt.id === hintAttemptId
    && (attempt.step === 'ai-polish' || pendingTriggerId === attempt.id)
    ? attempt.step
    : null

  return {
    progress,
    actionLabel,
    notice,
    busy: busy || workspaceId === null,
    startCurrentStep,
    reset,
    hintedStep,
    dismissHint,
    showOrganizeCompletion: !setupVisible && Boolean(currentStep) && completedStep === 'organize-note',
    dismissOrganizeCompletion: useDesktopOnboardingStore.getState().clearCompletion,
  }
}
