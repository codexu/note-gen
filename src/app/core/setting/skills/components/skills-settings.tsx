'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadRecommendedSkills } from '@/lib/skills/recommendations'
import { useSkillsStore } from '@/stores/skills'
import { GlobalSkillsManager } from './global-skills-manager'
import { ProjectSkillsList } from './project-skills-list'
import { RecommendedSkills } from './recommended-skills'

export function SkillsSettings({ showFileActions = true }: { showFileActions?: boolean }) {
  const t = useTranslations('settings.skills.tabs')
  const workspaceCount = useSkillsStore(state => state.projectSkills.length)
  const globalCount = useSkillsStore(state => state.globalSkills.length)
  const [discoveryCount, setDiscoveryCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void loadRecommendedSkills()
      .then(skills => {
        if (active) setDiscoveryCount(skills.length)
      })
      .catch(error => console.error('Failed to load recommended Skills count:', error))
    return () => { active = false }
  }, [])

  return (
    <Tabs defaultValue="global" className="min-w-0 gap-5">
      <TabsList className="grid w-full grid-cols-3 sm:w-fit">
        <TabsTrigger value="global">
          {t('global')}
          <Badge variant="secondary">{globalCount}</Badge>
        </TabsTrigger>
        <TabsTrigger value="workspace">
          {t('workspace')}
          <Badge variant="secondary">{workspaceCount}</Badge>
        </TabsTrigger>
        <TabsTrigger value="discover">
          {t('discover')}
          {discoveryCount !== null && <Badge variant="secondary">{discoveryCount}</Badge>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="global">
        <GlobalSkillsManager showFileActions={showFileActions} />
      </TabsContent>
      <TabsContent value="workspace">
        <ProjectSkillsList showFileActions={showFileActions} />
      </TabsContent>
      <TabsContent value="discover">
        <RecommendedSkills onCountChange={setDiscoveryCount} />
      </TabsContent>
    </Tabs>
  )
}
