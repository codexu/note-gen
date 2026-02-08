'use client'

import { GitBranch, Github, Gitlab, GitPullRequest } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

export function PrimarySyncBadge() {
  const [provider, setProvider] = useState<SyncProvider>('github')

  useEffect(() => {
    const loadProvider = async () => {
      try {
        const store = await Store.load('store.json')
        const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
        setProvider(primaryBackupMethod as SyncProvider)
      } catch {
        setProvider('github')
      }
    }

    loadProvider()
  }, [])

  const getProviderIcon = () => {
    switch (provider) {
      case 'github':
        return <Github size={10} />
      case 'gitee':
        return <GitBranch size={10} />
      case 'gitlab':
        return <Gitlab size={10} />
      case 'gitea':
        return <GitPullRequest size={10} />
      default:
        return <Github size={10} />
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

  return (
    <div className="flex items-center gap-0.5 px-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
      {getProviderIcon()}
      <span>{getProviderName()}</span>
    </div>
  )
}

export default PrimarySyncBadge
