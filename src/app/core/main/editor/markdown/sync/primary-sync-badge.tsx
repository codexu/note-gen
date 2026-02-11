'use client'

import { GitBranch, Github, Gitlab, GitPullRequest } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isSyncConfigured } from '@/lib/sync/sync-manager'

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

export function PrimarySyncBadge() {
  const [provider, setProvider] = useState<SyncProvider>('github')
  const [isConfigured, setIsConfigured] = useState(false)

  useEffect(() => {
    const loadProvider = async () => {
      const configured = await isSyncConfigured()
      setIsConfigured(configured)

      if (configured) {
        try {
          const { Store } = await import('@tauri-apps/plugin-store')
          const store = await Store.load('store.json')
          const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
          setProvider(primaryBackupMethod as SyncProvider)
        } catch {
          setProvider('github')
        }
      }
    }

    loadProvider()
  }, [])

  const getProviderIcon = () => {
    switch (provider) {
      case 'github':
        return <Github size={14} />
      case 'gitee':
        return <GitBranch size={14} />
      case 'gitlab':
        return <Gitlab size={14} />
      case 'gitea':
        return <GitPullRequest size={14} />
      default:
        return <Github size={14} />
    }
  }

  const getProviderName = () => {
    switch (provider) {
      case 'github':
        return 'GitHub'
      case 'gitee':
        return 'Gitee'
      case 'gitlab':
        return 'GitLab'
      case 'gitea':
        return 'Gitea'
      default:
        return 'GitHub'
    }
  }

  // 如果没有配置同步，不显示
  if (!isConfigured) return null

  return (
    <div className="flex items-center gap-0.5 px-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
      {getProviderIcon()}
      <span>{getProviderName()}</span>
    </div>
  )
}

export default PrimarySyncBadge
