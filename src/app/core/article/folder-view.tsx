'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Folder, Database, Clock, RefreshCw, Loader2, FileText, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import useArticleStore from '@/stores/article'
import useVectorStore from '@/stores/vector'
import { useSkillsStore } from '@/stores/skills'
import { isSkillsFolder, extractSkillIdFromPath } from '@/lib/skills/utils'
import { getVectorDocumentsByFilename } from '@/db/vector'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface FolderViewProps {
  folderPath: string
}

interface FolderStats {
  totalFiles: number
  indexedFiles: number
  totalVectors: number
  databaseSize: string
  lastUpdated: string | null
}

interface SkillMetadata {
  id: string
  name: string
  description: string
  version: string
  author?: string
  scope: 'global' | 'project'
  model?: string
  allowedTools?: string[]
  userInvocable: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface SkillContent {
  metadata: SkillMetadata
  instructions: string
  examples?: string
  resources: any[]
}

// Skills 列表视图组件
function SkillsListView({
  skills,
}: {
  skills: SkillMetadata[]
}) {
  // 按 scope 分组
  const globalSkills = skills.filter(s => s.scope === 'global')
  const projectSkills = skills.filter(s => s.scope === 'project')

  // 跟踪每个技能的展开状态
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())

  const toggleExpanded = (skillId: string) => {
    setExpandedSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-background gap-6 p-8">
      {/* Skills Icon and Name */}
      <div className="flex flex-col items-center gap-3">
        <Sparkles className="w-20 h-20 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Skills ({skills.length})</h2>
      </div>

      {/* Skills 列表 */}
      {skills.length === 0 ? null : (
        <div className="flex flex-col gap-4 w-full max-w-2xl">
          {/* 全局 Skills */}
          {globalSkills.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground px-1">全局 Skills</h3>
              {globalSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-4 border rounded-lg hover:bg-accent/5 transition-colors bg-blue-50/50 dark:bg-blue-950/20 cursor-pointer"
                  onClick={() => toggleExpanded(skill.id)}
                >
                  <div className="flex items-start gap-4">
                    <Sparkles className="size-5 text-primary mt-1" />
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{skill.name}</h3>
                      <p className="text-sm text-muted-foreground cursor-pointer">
                        {expandedSkills.has(skill.id) ? skill.description : (
                          <span className="line-clamp-1">{skill.description}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 工作区 Skills */}
          {projectSkills.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground px-1">工作区 Skills</h3>
              {projectSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-4 border rounded-lg hover:bg-accent/5 transition-colors bg-purple-50/50 dark:bg-purple-950/20 cursor-pointer"
                  onClick={() => toggleExpanded(skill.id)}
                >
                  <div className="flex items-start gap-4">
                    <Sparkles className="size-5 text-primary mt-1" />
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{skill.name}</h3>
                      <p className="text-sm text-muted-foreground cursor-pointer">
                        {expandedSkills.has(skill.id) ? skill.description : (
                          <span className="line-clamp-1">{skill.description}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 单个 Skill 详情视图组件
function SkillDetailView({
  skillContent,
}: {
  skillContent: SkillContent
}) {
  const { metadata, instructions, examples } = skillContent

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-background gap-6 p-8 overflow-y-auto">
      {/* Skill Icon and Name */}
      <div className="flex flex-col items-center gap-3">
        <Sparkles className="w-20 h-20 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">{metadata.name}</h2>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {metadata.description}
        </p>
      </div>

      {/* Skill Details */}
      <div className="flex flex-col gap-4 w-full max-w-2xl">
        {/* 指令 */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-sm">指令</h3>
          <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-60 overflow-y-auto">
            {instructions}
          </div>
        </div>

        {/* 示例 */}
        {examples && (
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">示例</h3>
            <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-60 overflow-y-auto">
              {examples}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function FolderView({ folderPath }: FolderViewProps) {
  const [stats, setStats] = useState<FolderStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{
    total: number
    processed: number
    failed: number
    currentFile: string
  } | null>(null)

  const { fileTree, vectorIndexedFiles } = useArticleStore()
  const { isVectorDbEnabled } = useVectorStore()
  const { getSkillsByScope, initSkills, initialized: skillsStoreInitialized } = useSkillsStore()

  const folderName = folderPath.split('/').pop() || folderPath

  // 检查是否是 Skills 文件夹
  const isSkillsView = isSkillsFolder(folderName)

  // 检查是否是 Skill 子文件夹（单个 skill）
  const skillId = extractSkillIdFromPath(folderPath)
  const isSkillDetailView = skillId !== null

  // 初始化 Skills（如果是 Skills 相关视图）
  useEffect(() => {
    if ((isSkillsView || isSkillDetailView) && !skillsStoreInitialized) {
      initSkills()
    }
  }, [isSkillsView, isSkillDetailView, skillsStoreInitialized, initSkills])

  // 原有的文件夹向量视图逻辑...
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function collectFiles(_tree: typeof fileTree, _targetPath: string): string[] {
    const files: string[] = []

    // Helper to collect files from a directory and its subdirectories
    function collectFromDirectory(item: typeof fileTree[0], currentPath: string) {
      if (item.isFile && item.name.endsWith('.md')) {
        files.push(currentPath)
        return
      }

      if (item.isDirectory && item.children) {
        for (const child of item.children) {
          const childPath = currentPath ? `${currentPath}/${child.name}` : child.name
          collectFromDirectory(child, childPath)
        }
      }
    }

    // Find the target folder in the tree
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function findAndCollect(_tree: typeof fileTree, _targetPath: string): boolean {
      for (const item of _tree) {
        if (item.isDirectory && folderPath === _targetPath) {
          // Found the target folder, collect all files recursively
          if (item.children) {
            for (const child of item.children) {
              const childPath = `${folderPath}/${child.name}`
              collectFromDirectory(child, childPath)
            }
          }
          return true
        }

        // Search in subdirectories
        if (item.children && findAndCollect(item.children, _targetPath)) {
          return true
        }
      }
      return false
    }

    findAndCollect(fileTree, folderPath)
    return files
  }

  // Get all files in the current folder (recursively)
  const folderFiles = useMemo(() => collectFiles(fileTree, folderPath), [fileTree, folderPath])

  // Calculate folder statistics
  const calculateStats = useCallback(async () => {
    setLoadingStats(true)

    try {
      const totalFiles = folderFiles.length
      const indexedFiles = folderFiles.filter(file => {
        const filename = file.split('/').pop() || file
        return vectorIndexedFiles.has(filename)
      }).length

      let totalVectors = 0
      for (const file of folderFiles) {
        const filename = file.split('/').pop() || file
        if (vectorIndexedFiles.has(filename)) {
          const docs = await getVectorDocumentsByFilename(filename)
          totalVectors += docs.length
        }
      }

      const dbSizeBytes = totalVectors * 2048
      const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2)
      const databaseSize = dbSizeBytes < 1024 * 1024
        ? `${(dbSizeBytes / 1024).toFixed(2)} KB`
        : `${dbSizeMB} MB`

      const timestamps = Array.from(vectorIndexedFiles.values())
      const lastUpdated = timestamps.length > 0
        ? dayjs(Math.max(...timestamps)).fromNow()
        : null

      setStats({
        totalFiles,
        indexedFiles,
        totalVectors,
        databaseSize,
        lastUpdated
      })
    } catch (error) {
      console.error('Failed to calculate folder stats:', error)
    } finally {
      setLoadingStats(false)
    }
  }, [folderFiles, vectorIndexedFiles])

  // Initial stats calculation
  useEffect(() => {
    calculateStats()
  }, [calculateStats])

  // Start batch recalculation
  const startRecalculation = useCallback(async () => {
    const filesToProcess = folderFiles
    if (filesToProcess.length === 0) return

    let processed = 0
    let failed = 0

    setBatchProgress({
      total: filesToProcess.length,
      processed: 0,
      failed: 0,
      currentFile: ''
    })

    const CONCURRENCY = 3
    const queue = [...filesToProcess]

    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY)

      try {
        await Promise.all(
          batch.map(async (filePath) => {
            try {
              const filename = filePath.split('/').pop() || filePath
              let content = ''

              const workspace = await getWorkspacePath()
              if (workspace.isCustom) {
                content = await readTextFile(filePath)
              } else {
                const { path, baseDir } = await getFilePathOptions(filePath)
                content = await readTextFile(path, { baseDir })
              }

              const { processMarkdownFile } = await import('@/lib/rag')
              await processMarkdownFile(filePath, content)

              processed++

              setBatchProgress(prev => prev ? {
                ...prev,
                processed,
                currentFile: filename
              } : null)
            } catch (error) {
              console.error(`Failed to process ${filePath}:`, error)
              failed++
              setBatchProgress(prev => prev ? {
                ...prev,
                failed,
                processed: processed + 1
              } : null)
            }
          })
        )
      } catch (error) {
        console.error('Batch processing error:', error)
      }
    }

    // 刷新向量索引文件列表，以便 calculateStats 获取最新数据
    await useArticleStore.getState().initVectorIndexedFiles()
    await calculateStats()
    setBatchProgress(null)
  }, [folderFiles, calculateStats])

  // 如果是 Skills 文件夹，显示 Skills 视图
  if (isSkillsView) {
    // 如果 skills 还未初始化，显示加载状态
    if (!skillsStoreInitialized) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-4">加载 Skills...</p>
        </div>
      )
    }

    const globalSkills = getSkillsByScope('global')
    const projectSkills = getSkillsByScope('project')
    const allSkills = [...globalSkills, ...projectSkills].map(s => s.metadata)
    return <SkillsListView skills={allSkills} />
  }

  // 如果是 Skill 子文件夹，显示 Skill 详情视图
  if (isSkillDetailView) {
    // 如果 skills 还未初始化，显示加载状态
    if (!skillsStoreInitialized) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-4">加载 Skill...</p>
        </div>
      )
    }

    // 获取所有 skills 并查找匹配的 skill
    const globalSkills = getSkillsByScope('global')
    const projectSkills = getSkillsByScope('project')
    const allSkills = [...globalSkills, ...projectSkills]

    const skillContent = allSkills.find(s => s.metadata.id === skillId)

    if (!skillContent) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Sparkles className="w-16 h-16 text-muted-foreground" />
          <h2 className="text-2xl font-semibold tracking-tight mt-4">Skill 未找到</h2>
          <p className="text-muted-foreground text-sm mt-2">
            无法找到 ID 为 {skillId} 的 Skill
          </p>
        </div>
      )
    }

    return <SkillDetailView skillContent={skillContent} />
  }

  if (!isVectorDbEnabled) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Folder className="w-16 h-16 text-muted-foreground" />
          <h2 className="text-2xl font-semibold tracking-tight">{folderName}</h2>
          <p className="text-muted-foreground text-sm">
            向量数据库未启用
          </p>
        </div>
      </div>
    )
  }

  if (loadingStats && !stats) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-background gap-6 p-8">
      {/* Folder Icon and Name */}
      <div className="flex flex-col items-center gap-3">
        <Folder className="w-20 h-20 text-muted-foreground" />
        <h2 className="text-2xl font-semibold tracking-tight">{folderName}</h2>
      </div>

      {/* Stats Display */}
      {stats && (
        <div className="flex flex-col gap-3 w-full max-w-md">
          {/* Indexed Files Count */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              已计算
            </span>
            <span className="font-medium">
              {stats.indexedFiles} / {stats.totalFiles}
            </span>
          </div>

          {/* Total Vectors */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              向量数
            </span>
            <span className="font-medium">{stats.totalVectors}</span>
          </div>

          {/* Database Size */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              数据库大小
            </span>
            <span className="font-medium">{stats.databaseSize}</span>
          </div>

          {/* Last Updated */}
          <div className="flex items-center justify-between text-sm py-2">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              最后计算
            </span>
            <span className="font-medium">
              {stats.lastUpdated || '从未'}
            </span>
          </div>
        </div>
      )}

      {/* Progress Bar during batch processing */}
      {batchProgress && (
        <div className="w-full max-w-md space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>计算中...</span>
            <span>{batchProgress.processed} / {batchProgress.total}</span>
          </div>
          <Progress value={(batchProgress.processed / batchProgress.total) * 100} className="h-2" />
          {batchProgress.failed > 0 && (
            <p className="text-xs text-destructive">
              失败: {batchProgress.failed}
            </p>
          )}
        </div>
      )}

      {/* Recalculate Button */}
      <Button
        variant="outline"
        onClick={startRecalculation}
        disabled={!!batchProgress || !stats || stats.totalFiles === 0}
        className="gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${batchProgress ? 'animate-spin' : ''}`} />
        重新计算向量
      </Button>
    </div>
  )
}