'use client'

import { useEffect, useState } from 'react'
import { CircleX, CircleCheck, CircleDot, Cloud, Database, Github } from 'lucide-react'
import useSettingStore from '@/stores/setting'
import { getUserInfo as getGithubUser, checkSyncRepoState as checkGithubRepo } from '@/lib/github'
import { getUserInfo as getGiteeUser, checkSyncRepoState as checkGiteeRepo } from '@/lib/gitee'
import { useTranslations } from 'next-intl'

type SyncStatus = 'checking' | 'synced' | 'error' | 'offline'

interface StatusInfo {
  status: SyncStatus
  message?: string
  user?: { 
    username: string
    avatar?: string 
  }
}

const StatusIcon = ({ status }: { status: SyncStatus }) => {
  switch (status) {
    case 'checking': return <CircleDot className="h-4 w-4 text-blue-500 animate-pulse" />
    case 'synced': return <CircleCheck className="h-4 w-4 text-green-500" />
    case 'error': return <CircleX className="h-4 w-4 text-red-500" />
    case 'offline': return <Database className="h-4 w-4 text-gray-400" />
  }
}

export default function AppStatus() {
  const t = useTranslations('common')
  
  // Get current primary backup method user info
  const { accessToken, githubUsername, giteeAccessToken, primaryBackupMethod } = useSettingStore()
  
  // Get GitHub user info
  const [githubStatus, setGithubStatus] = useState<StatusInfo>({
    status: 'offline'
  })
  
  // Get Gitee user info  
  const [giteeStatus, setGiteeStatus] = useState<StatusInfo>({
    status: 'offline'
  })

  useEffect(() => {
    if (accessToken) {
      // Check repository status - GitHub
      checkGithubStatus()
    }
    
    if (giteeAccessToken) {
      // Get Gitee user info
      checkGiteeStatus()
    }
  }, [accessToken, giteeAccessToken])

  const checkGithubStatus = async () => {
    if (!accessToken) return
    
    setGithubStatus({ status: 'checking' })
    
    try {
      // Check GitHub repository status
      const userResponse = await getGithubUser()
      
      if (userResponse && userResponse.data) {
        const user = userResponse.data
        setGithubStatus({
          status: 'synced',
          user: {
            username: user.login,
            avatar: user.avatar_url
          },
          message: `Connected as ${user.login}`
        })
        
        // Check sync repository status
        if (githubUsername) {
          const noteRepo = await checkGithubRepo(`${githubUsername}-note`)
          if (!noteRepo) {
            setGithubStatus(prev => ({
              ...prev,
              status: 'error',
              message: 'Note repository not found'
            }))
          }
        }
      } else {
        setGithubStatus({
          status: 'error',
          message: 'Failed to connect to GitHub'
        })
      }
    } catch (error) {
      setGithubStatus({
        status: 'error',
        message: 'GitHub connection failed'
      })
    }
  }

  const checkGiteeStatus = async () => {
    if (!giteeAccessToken) return
    
    setGiteeStatus({ status: 'checking' })
    
    try {
      // Check Gitee repository status
      const user = await getGiteeUser()
      
      if (user) {
        setGiteeStatus({
          status: 'synced',
          user: {
            username: user.login,
            avatar: user.avatar_url
          },
          message: `Connected as ${user.login}`
        })
        
        // Check sync repository status
        if (user.login) {
          const noteRepo = await checkGiteeRepo(`${user.login}-note`)
          if (!noteRepo) {
            setGiteeStatus(prev => ({
              ...prev,
              status: 'error',
              message: 'Note repository not found'
            }))
          }
        }
      } else {
        setGiteeStatus({
          status: 'error',
          message: 'Failed to connect to Gitee'
        })
      }
    } catch (error) {
      setGiteeStatus({
        status: 'error',
        message: 'Gitee connection failed'
      })
    }
  }

  const currentStatus = primaryBackupMethod === 'github' ? githubStatus : giteeStatus
  const currentIcon = primaryBackupMethod === 'github' ? <Github className="h-4 w-4" /> : <Cloud className="h-4 w-4" />

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-sidebar-accent/10">
      {currentIcon}
      <StatusIcon status={currentStatus.status} />
      {currentStatus.user && (
        <span className="text-xs text-sidebar-foreground/70 truncate">
          {currentStatus.user.username}
        </span>
      )}
    </div>
  )
}