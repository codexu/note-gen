'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import useArticleStore, { findFolderInTree } from '@/stores/article'
import emitter from '@/lib/emitter'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import useChatStore from '@/stores/chat'
import { OnboardingSpotlight } from '@/components/onboarding-spotlight'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MdEditor } from './markdown/md-editor-wrapper'
import { TabBar, TabInfo } from './tab-bar'
import { ImageEditor } from './image/image-editor'
import { EmptyState } from './empty-state'
import { FolderView } from './folder'
import { UnsupportedFile } from './unsupported-file'
import {
  createDefaultOnboardingProgress,
  getCompletionFeedbackMode,
  getActiveOnboardingStep,
  markOnboardingStepDone,
  normalizeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingStepId,
} from './onboarding-state'
import {
  findRecentOnboardingFile,
  getOnboardingAgentPrompt,
  getOnboardingSpotlightTarget,
  ONBOARDING_SAMPLE_RECORD,
} from './empty-state-actions'

// 常量：扩展名到类型的映射（避免每次渲染时重新创建）
const MARKDOWN_EXTENSIONS = new Set([
  'md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less',
  'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go',
  'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg',
  'gitignore', 'env', 'example', 'template'
])

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'])
const ONBOARDING_PROGRESS_STORE_KEY = 'desktopOnboardingProgress'

export function EditorLayout() {
  const {
    activeFilePath,
    fileTree,
    setActiveFilePath,
    openTabs,
    activeTabId,
    setOpenTabs,
    setActiveTabId,
    addTab,
    removeTab,
    initOpenTabs,
    initShowCloudFiles
  } = useArticleStore()
  const { setLeftSidebarTab, rightSidebarVisible, toggleRightSidebar } = useSidebarStore()
  const { setOnboardingPromptDraft } = useChatStore()
  const tOnboarding = useTranslations('article.emptyState.onboarding')

  const tabContentsRef = useRef<Record<string, string>>({})
  const [tabs, setLocalTabs] = useState<TabInfo[]>([])
  const [localActiveTabId, setLocalActiveTabId] = useState<string>('')
  const tabsRef = useRef<TabInfo[]>([])
  const isInitializedRef = useRef(false)
  const currentOnboardingTaskRef = useRef<OnboardingStepId | null>(null)
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress>(createDefaultOnboardingProgress())
  const [currentOnboardingTask, setCurrentOnboardingTask] = useState<OnboardingStepId | null>(null)
  const [activeOnboardingStep, setActiveOnboardingStep] = useState<OnboardingStepId | null>(null)
  const [completedOnboardingStep, setCompletedOnboardingStep] = useState<OnboardingStepId | null>(null)
  const [showOrganizeNextStepDialog, setShowOrganizeNextStepDialog] = useState(false)
  const [onboardingResumeFilePath, setOnboardingResumeFilePath] = useState('')

  const persistOnboardingProgress = useCallback(async (progress: OnboardingProgress) => {
    const store = await Store.load('store.json')
    await store.set(ONBOARDING_PROGRESS_STORE_KEY, progress)
    await store.save()
  }, [])

  // Initialize tabs from store on mount
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true
      initOpenTabs()
      initShowCloudFiles()
    }
  }, [initOpenTabs, initShowCloudFiles])

  useEffect(() => {
    const loadOnboardingProgress = async () => {
      const store = await Store.load('store.json')
      const savedProgress = await store.get<OnboardingProgress>(ONBOARDING_PROGRESS_STORE_KEY)
      setOnboardingProgress(normalizeOnboardingProgress(savedProgress))
    }

    void loadOnboardingProgress()
  }, [])

  useEffect(() => {
    currentOnboardingTaskRef.current = currentOnboardingTask
  }, [currentOnboardingTask])

  useEffect(() => {
    const handleOnboardingStepComplete = ({
      step,
      filePath,
    }: { step: OnboardingStepId; filePath?: string }) => {
      setOnboardingProgress((current) => {
        if (current.steps[step]) {
          return current
        }

        const nextProgress = markOnboardingStepDone(current, step)
        const feedbackMode = getCompletionFeedbackMode(step, currentOnboardingTaskRef.current)

        if (feedbackMode === 'dialog') {
          const resumeFilePath = filePath || activeFilePath
          setOnboardingResumeFilePath(resumeFilePath)
          setCurrentOnboardingTask(null)
          setActiveOnboardingStep(null)
          setCompletedOnboardingStep(null)
          setShowOrganizeNextStepDialog(true)
        } else if (currentOnboardingTaskRef.current) {
          setCurrentOnboardingTask(null)
          setActiveOnboardingStep(null)
          setCompletedOnboardingStep(step)
        }
        void persistOnboardingProgress(nextProgress)
        return nextProgress
      })
    }

    emitter.on('onboarding-step-complete', handleOnboardingStepComplete)
    return () => {
      emitter.off('onboarding-step-complete', handleOnboardingStepComplete)
    }
  }, [activeFilePath, persistOnboardingProgress])

  // Sync with store
  useEffect(() => {
    setLocalTabs(openTabs)
    tabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    setLocalActiveTabId(activeTabId)
  }, [activeTabId])

  // Helper to check if path is a folder
  const isFolderPath = useCallback((path: string): boolean => {
    const fileName = path.split('/').pop() || ''
    return !fileName.includes('.')
  }, [])

  // Get item type based on path
  const getItemType = useCallback((path: string): 'markdown' | 'image' | 'folder' | 'unknown' => {
    if (!path) return 'unknown'

    // First check if it's a folder
    const folder = findFolderInTree(path, fileTree)
    if (folder) return 'folder'

    // Check file extension
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return 'unknown'

    if (MARKDOWN_EXTENSIONS.has(extension)) {
      return 'markdown'
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return 'image'
    }
    return 'unknown'
  }, [fileTree])

  // Check if file/folder exists
  const checkPathExists = useCallback(async (path: string): Promise<boolean> => {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(path)

    try {
      if (workspace.isCustom) {
        return await exists(pathOptions.path)
      } else {
        return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      return false
    }
  }, [])

  // Check if path is a folder in fileTree
  const isFolderInTree = useCallback((path: string): boolean => {
    return !!findFolderInTree(path, fileTree)
  }, [fileTree])

  // Check if path is a file in fileTree
  const isFileInTree = useCallback((path: string): boolean => {
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return false

    const validExtensions = ['md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg', 'gitignore', 'env', 'example', 'template', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']

    if (!validExtensions.includes(extension)) return false

    // Check if file exists in fileTree
    const checkInTree = (items: typeof fileTree): boolean => {
      for (const item of items) {
        if (item.isFile && path.includes(item.name)) return true
        if (item.children) {
          if (checkInTree(item.children)) return true
        }
      }
      return false
    }
    return checkInTree(fileTree)
  }, [fileTree])

  // Clean up tabs that no longer exist
  useEffect(() => {
    const cleanupTabs = async () => {
      if (tabs.length === 0) return

      const validTabs: TabInfo[] = []
      let hasInvalid = false

      for (const tab of tabs) {
        if (tab.isFolder) {
          // Check if folder exists in fileTree
          if (isFolderInTree(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
          }
        } else {
          // Check if file exists in fileTree or on disk
          if (isFileInTree(tab.path) || await checkPathExists(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
            // Clean up content cache
            delete tabContentsRef.current[tab.path]
          }
        }
      }

      if (hasInvalid) {
        setOpenTabs(validTabs)
      }
    }

    cleanupTabs()
  }, [fileTree, tabs.length, isFolderInTree, isFileInTree, checkPathExists, setOpenTabs])

  // Initialize and update tabs when active path changes
  useEffect(() => {
    if (!activeFilePath) return

    const name = activeFilePath.split('/').pop() || activeFilePath
    const isFolder = isFolderPath(activeFilePath)

    // Check if tab already exists
    const existingTab = tabsRef.current.find(tab => tab.path === activeFilePath)

    if (existingTab) {
      // Set as active
      if (activeTabId !== existingTab.id) {
        setActiveTabId(existingTab.id)
      }
    } else {
      // Add new tab
      const newTab: TabInfo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        path: activeFilePath,
        name: name,
        isFolder: isFolder
      }
      addTab(newTab)
    }
  }, [activeFilePath, activeTabId, isFolderPath, addTab, setActiveTabId])

  // Handle tab switch
  const handleTabSwitch = useCallback((path: string) => {
    if (path) {
      setActiveFilePath(path)
    }
  }, [setActiveFilePath])

  // Handle new tab button - return to empty state without creating a file
  const handleNewTab = useCallback(async () => {
    await Promise.all([
      setActiveFilePath(''),
      setActiveTabId(''),
    ])
  }, [setActiveFilePath, setActiveTabId])

  // Handle close tab
  const handleCloseTab = useCallback((closedPath: string) => {
    // Bug fix: Emit event to clean up loadedPathsRef in MdEditor
    emitter.emit('editor-file-close', { path: closedPath })
    delete tabContentsRef.current[closedPath]

    // Get closedTab from the current ref value
    const closedTab = tabsRef.current.find(t => t.path === closedPath)
    if (!closedTab) return

    // Save the current tabs count before removing
    const tabsCountBeforeRemove = tabsRef.current.length

    // Remove the tab
    removeTab(closedTab.id)

    // Only switch active tab if we're closing the currently active tab
    if (localActiveTabId === closedTab.id) {
      if (tabsCountBeforeRemove > 1) {
        // Find the new target tab from the updated tabsRef after removal
        const remainingTabs = tabsRef.current.filter(t => t.id !== closedTab.id)
        if (remainingTabs.length > 0) {
          // Try to select the tab to the left, otherwise select the last one
          const currentIndex = tabsRef.current.findIndex(t => t.id === closedTab.id)
          const targetTab = remainingTabs[Math.max(0, currentIndex - 1)] || remainingTabs[remainingTabs.length - 1]
          setActiveTabId(targetTab.id)
          setActiveFilePath(targetTab.path)
        }
      } else {
        setActiveTabId('')
        setActiveFilePath('')
      }
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close other tabs
  const handleCloseOtherTabs = useCallback((keepPath: string) => {
    const tabsToRemove = tabsRef.current.filter(t => t.path !== keepPath)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    const keptTab = tabsRef.current.find(t => t.path === keepPath)
    if (keptTab && localActiveTabId !== keptTab.id) {
      setActiveTabId(keptTab.id)
      setActiveFilePath(keptTab.path)
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close all tabs
  const handleCloseAllTabs = useCallback(() => {
    tabsRef.current.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
    setActiveTabId('')
    setActiveFilePath('')
  }, [removeTab, setActiveTabId, setActiveFilePath])

  // Handle close left tabs
  const handleCloseLeftTabs = useCallback((rightPath: string) => {
    const rightIndex = tabsRef.current.findIndex(t => t.path === rightPath)
    const tabsToRemove = tabsRef.current.slice(0, rightIndex)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    if (rightIndex > 0) {
      const rightTab = tabsRef.current[rightIndex]
      if (rightTab && localActiveTabId !== rightTab.id) {
        setActiveTabId(rightTab.id)
        setActiveFilePath(rightTab.path)
      }
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close right tabs
  const handleCloseRightTabs = useCallback((leftPath: string) => {
    const leftIndex = tabsRef.current.findIndex(t => t.path === leftPath)
    const tabsToRemove = tabsRef.current.slice(leftIndex + 1)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
  }, [removeTab])

  const onboardingAgentPrompt = getOnboardingAgentPrompt({
    intro: tOnboarding('agentPrompt.intro'),
    requirements: [
      tOnboarding('agentPrompt.requirement1'),
      tOnboarding('agentPrompt.requirement2'),
      tOnboarding('agentPrompt.requirement3'),
      tOnboarding('agentPrompt.requirement4'),
    ],
    outro: tOnboarding('agentPrompt.outro'),
  })

  const handleStartOnboardingStep = useCallback(async (step: OnboardingStepId) => {
    if (onboardingProgress.dismissed) {
      const nextProgress = {
        ...onboardingProgress,
        dismissed: false,
      }
      setOnboardingProgress(nextProgress)
      await persistOnboardingProgress(nextProgress)
    }

    setCurrentOnboardingTask(step)
    setActiveOnboardingStep(step)
    setCompletedOnboardingStep(null)
    setShowOrganizeNextStepDialog(false)

    if (step === 'create-record') {
      emitter.emit('onboarding-record-prefill-changed', {
        prefillText: ONBOARDING_SAMPLE_RECORD,
      })
      await setLeftSidebarTab('notes')
      return
    }

    if (step === 'organize-note') {
      await setLeftSidebarTab('notes')
      return
    }

    if (step === 'ai-polish') {
      const candidateResumeFilePath = findRecentOnboardingFile({
        preferredPath: onboardingResumeFilePath,
        activeFilePath,
        openTabPaths: openTabs.map((tab) => tab.path),
        fileTree,
      })
      const resolvedResumeFilePath = candidateResumeFilePath && await checkPathExists(candidateResumeFilePath)
        ? candidateResumeFilePath
        : ''

      if (!rightSidebarVisible) {
        await toggleRightSidebar()
      }
      if (resolvedResumeFilePath) {
        await setActiveFilePath(resolvedResumeFilePath)
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      setOnboardingPromptDraft(onboardingAgentPrompt)
    }
  }, [activeFilePath, fileTree, onboardingAgentPrompt, onboardingProgress, onboardingResumeFilePath, openTabs, persistOnboardingProgress, rightSidebarVisible, setActiveFilePath, setLeftSidebarTab, setOnboardingPromptDraft, toggleRightSidebar])

  const handleDismissOnboarding = useCallback(async () => {
    const nextProgress = {
      ...onboardingProgress,
      dismissed: true,
    }

    setOnboardingProgress(nextProgress)
    setCurrentOnboardingTask(null)
    setActiveOnboardingStep(null)
    setCompletedOnboardingStep(null)
    setShowOrganizeNextStepDialog(false)
    await persistOnboardingProgress(nextProgress)
  }, [onboardingProgress, persistOnboardingProgress])

  const handleDismissSpotlight = useCallback(() => {
    setActiveOnboardingStep(null)
  }, [])

  const handleDismissOrganizeNextStepDialog = useCallback(() => {
    setShowOrganizeNextStepDialog(false)
  }, [])

  const handleAcceptOrganizeNextStepDialog = useCallback(async () => {
    setShowOrganizeNextStepDialog(false)
    setCompletedOnboardingStep('organize-note')
    await Promise.all([
      setActiveFilePath(''),
      setActiveTabId(''),
    ])
  }, [setActiveFilePath, setActiveTabId])

  const handleContinueToNextStep = useCallback(() => {
    const nextStep = getActiveOnboardingStep(onboardingProgress)
    setCompletedOnboardingStep(null)
    if (nextStep) {
      void handleStartOnboardingStep(nextStep)
    }
  }, [handleStartOnboardingStep, onboardingProgress])

  const spotlightTitle = activeOnboardingStep ? tOnboarding(`spotlight.${activeOnboardingStep}.title`) : ''
  const spotlightDescription = activeOnboardingStep ? tOnboarding(`spotlight.${activeOnboardingStep}.desc`) : ''

  // Render content panel for a tab
  const renderContentPanel = useCallback((tab: TabInfo, isActive: boolean) => {
    const itemType = getItemType(tab.path)

    return (
      <div
        key={tab.id}
        className="flex min-h-0 flex-1 overflow-hidden"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        {itemType === 'folder' && (
          <FolderView folderPath={tab.path} />
        )}
        {itemType === 'image' && (
          <ImageEditor filePath={tab.path} />
        )}
        {itemType === 'markdown' && (
          <MdEditor
            key={tab.id}
            tabContentsRef={tabContentsRef}
            filePath={tab.path}
          />
        )}
        {itemType === 'unknown' && (
          <UnsupportedFile filePath={tab.path} />
        )}
      </div>
    )
  }, [getItemType])

  // No tabs or no active tab - show empty state
  if (tabs.length === 0 || !activeTabId) {
    return (
      <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSwitch={handleTabSwitch}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseLeftTabs={handleCloseLeftTabs}
          onCloseRightTabs={handleCloseRightTabs}
        />
        <EmptyState
          onboardingProgress={onboardingProgress}
          activeOnboardingStep={currentOnboardingTask}
          visibleOnboardingStep={activeOnboardingStep}
          completedOnboardingStep={completedOnboardingStep}
          onStartOnboardingStep={handleStartOnboardingStep}
          onContinueToNextStep={handleContinueToNextStep}
          onDismissOnboarding={handleDismissOnboarding}
        />
        <OnboardingSpotlight
          targetId={activeOnboardingStep ? getOnboardingSpotlightTarget(activeOnboardingStep) : null}
          title={spotlightTitle}
          description={spotlightDescription}
          onDismiss={handleDismissSpotlight}
        />
        <Dialog open={showOrganizeNextStepDialog} onOpenChange={setShowOrganizeNextStepDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tOnboarding('afterOrganizeDialog.title')}</DialogTitle>
              <DialogDescription>{tOnboarding('afterOrganizeDialog.description')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                onClick={handleDismissOrganizeNextStepDialog}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {tOnboarding('afterOrganizeDialog.cancel')}
              </button>
              <button
                onClick={() => void handleAcceptOrganizeNextStepDialog()}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                {tOnboarding('afterOrganizeDialog.confirm')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={localActiveTabId}
        onTabSwitch={handleTabSwitch}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseLeftTabs={handleCloseLeftTabs}
        onCloseRightTabs={handleCloseRightTabs}
      />

      {/* Only render active tab content - improves performance with many tabs */}
      {tabs.filter(tab => tab.id === localActiveTabId).map(tab => renderContentPanel(tab, true))}
      <OnboardingSpotlight
        targetId={activeOnboardingStep ? getOnboardingSpotlightTarget(activeOnboardingStep) : null}
        title={spotlightTitle}
        description={spotlightDescription}
        onDismiss={handleDismissSpotlight}
      />
      <Dialog open={showOrganizeNextStepDialog} onOpenChange={setShowOrganizeNextStepDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tOnboarding('afterOrganizeDialog.title')}</DialogTitle>
            <DialogDescription>{tOnboarding('afterOrganizeDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={handleDismissOrganizeNextStepDialog}
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {tOnboarding('afterOrganizeDialog.cancel')}
            </button>
            <button
              onClick={() => void handleAcceptOrganizeNextStepDialog()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              {tOnboarding('afterOrganizeDialog.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
