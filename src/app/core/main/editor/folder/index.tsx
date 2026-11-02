'use client'

import { useEffect, useMemo } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import useArticleStore from '@/stores/article'
import { useSkillsStore } from '@/stores/skills'
import { computedParentPath } from '@/lib/path'
import { isSkillsFolder, extractSkillIdFromPath } from '@/lib/skills/utils'
import { FolderStatsView } from './folder-stats'
import { SkillsListView } from './skills-list'
import { SkillDetailView } from './skill-detail'
import { WikiFolderView } from './wiki-folder-view'
import { isWikiFolderPath } from '@/lib/wiki/path'

interface FolderViewProps {
  folderPath: string
}

// Collect all markdown files in the target folder recursively
function collectFiles(tree: ReturnType<typeof useArticleStore.getState>['fileTree'], targetPath: string): string[] {
  const files: string[] = []

  // Helper to collect files from a directory and its subdirectories
  function collectFromDirectory(item: NonNullable<typeof tree[0]>, currentPath: string) {
    if (item.isFile && item.name.endsWith('.md')) {
      files.push(currentPath)
      return
    }

    if (item.isDirectory && item.children) {
      for (const child of item.children) {
        const childPath = currentPath ? `${currentPath}/${child.name}` : child.name
        collectFromDirectory(child as NonNullable<typeof child>, childPath)
      }
    }
  }

  // Find the target folder in the tree
  function findAndCollect(_tree: NonNullable<typeof tree>, _targetPath: string): boolean {
    for (const item of _tree) {
      const itemPath = computedParentPath(item)

      if (item.isDirectory && itemPath === _targetPath) {
        // Found the target folder, collect all files recursively
        if (item.children) {
          for (const child of item.children) {
            const childPath = `${targetPath}/${child.name}`
            collectFromDirectory(child as NonNullable<typeof child>, childPath)
          }
        }
        return true
      }

      // Search in subdirectories
      if (item.children && findAndCollect(item.children as NonNullable<typeof item.children>, _targetPath)) {
        return true
      }
    }
    return false
  }

  if (tree) {
    if (!targetPath) {
      for (const item of tree) collectFromDirectory(item, item.name)
    } else findAndCollect(tree, targetPath)
  }
  return files
}

export function FolderView({ folderPath }: FolderViewProps) {
  const t = useTranslations('article.file.folderView')
  const fileTree = useArticleStore(state => state.fileTree)
  const { getSkillsByScope, initSkills, initialized: skillsStoreInitialized } = useSkillsStore()

  // 检查是否是 Skills 文件夹
  const isWikiView = isWikiFolderPath(folderPath)
  const isSkillsView = !isWikiView && isSkillsFolder(folderPath.split('/').pop() || '')

  // 检查是否是 Skill 子文件夹（单个 skill）
  const skillId = extractSkillIdFromPath(folderPath)
  const isSkillDetailView = !isWikiView && skillId !== null

  // 初始化 Skills（如果是 Skills 相关视图）
  useEffect(() => {
    if ((isSkillsView || isSkillDetailView) && !skillsStoreInitialized) {
      initSkills()
    }
  }, [isSkillsView, isSkillDetailView, skillsStoreInitialized, initSkills])

  // Get all files in the current folder (recursively)
  const folderFiles = useMemo(() => isWikiView ? [] : collectFiles(fileTree, folderPath), [fileTree, folderPath, isWikiView])

  if (isWikiView) return <WikiFolderView folderPath={folderPath} />

  // If it's a Skills folder, show Skills view
  if (isSkillsView) {
    // If skills not initialized yet, show loading state
    if (!skillsStoreInitialized) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-4">{t('loadingSkills')}</p>
        </div>
      )
    }

    const globalSkills = getSkillsByScope('global')
    const projectSkills = getSkillsByScope('project')
    const allSkills = [...globalSkills, ...projectSkills].map(s => s.metadata)
    return <SkillsListView skills={allSkills} />
  }

  // If it's a Skill subfolder, show Skill detail view
  if (isSkillDetailView) {
    // If skills not initialized yet, show loading state
    if (!skillsStoreInitialized) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-4">{t('loadingSkill')}</p>
        </div>
      )
    }

    // Get all skills and find matching skill
    const globalSkills = getSkillsByScope('global')
    const projectSkills = getSkillsByScope('project')
    const allSkills = [...globalSkills, ...projectSkills]

    const skillContent = allSkills.find(s => s.metadata.id === skillId)

    if (!skillContent) {
      return (
        <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
          <Sparkles className="w-16 h-16 text-muted-foreground" />
          <h2 className="text-2xl font-semibold tracking-tight mt-4">{t('skillNotFound')}</h2>
          <p className="text-muted-foreground text-sm mt-2">
            {t('skillNotFoundDesc', { id: skillId || '' })}
          </p>
        </div>
      )
    }

    return <SkillDetailView skillContent={skillContent} />
  }

  // 普通文件夹视图
  return <FolderStatsView folderPath={folderPath} folderFiles={folderFiles} />
}
