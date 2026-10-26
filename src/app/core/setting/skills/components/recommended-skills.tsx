'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Download, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import {
  getRecommendedSkillText,
  loadRecommendedSkills,
  type RecommendedSkill,
} from '@/lib/skills/recommendations'
import { useSkillsStore } from '@/stores/skills'
import { SettingSection } from '../../components/setting-base'
import { RecommendedSkillInstallDialog } from './recommended-skill-install-dialog'

export function RecommendedSkills({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const t = useTranslations('settings.skills.recommended')
  const locale = useLocale()
  const { toast } = useToast()
  const globalSkills = useSkillsStore(state => state.globalSkills)
  const projectSkills = useSkillsStore(state => state.projectSkills)
  const [skills, setSkills] = useState<RecommendedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<RecommendedSkill | null>(null)
  const installedIds = new Set([...globalSkills, ...projectSkills].map(skill => skill.id))

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void loadRecommendedSkills()
      .then(result => {
        if (active) {
          setSkills(result)
          onCountChange?.(result.length)
        }
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [refreshKey, onCountChange])

  const openSource = async (sourceUrl: string) => {
    try {
      await openUrl(sourceUrl)
    } catch (reason) {
      toast({
        title: t('source'),
        description: reason instanceof Error ? reason.message : String(reason),
        variant: 'destructive',
      })
    }
  }

  return (
    <SettingSection
      title={t('title')}
      desc={t('description')}
      actions={(
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={loading}
          onClick={() => setRefreshKey(value => value + 1)}
        >
          {loading ? <Spinner /> : <RefreshCw />}
        </Button>
      )}
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('loadError')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && skills.length === 0 ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('title')}>
          {[0, 1, 2].map(index => <Skeleton key={index} className="h-24 w-full" />)}
        </div>
      ) : skills.length > 0 ? (
        <ItemGroup className="gap-2" aria-busy={loading}>
          {skills.map(skill => {
            const installed = installedIds.has(skill.id)
            return (
              <Item key={skill.id} variant="outline">
                <ItemMedia variant="icon"><Sparkles /></ItemMedia>
                <ItemContent className="min-w-0 basis-48">
                  <ItemTitle>{getRecommendedSkillText(skill.name, locale)}</ItemTitle>
                  <ItemDescription>{getRecommendedSkillText(skill.description, locale)}</ItemDescription>
                  <ItemDescription>{t('author', { author: skill.author })}</ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <Button variant="ghost" size="icon-sm" aria-label={t('source')} title={t('source')} onClick={() => void openSource(skill.sourceUrl)}>
                    <ExternalLink />
                  </Button>
                  <Button variant="outline" size="sm" disabled={installed} onClick={() => setSelected(skill)}>
                    {installed ? <Check data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                    {installed ? t('installed') : t('install')}
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : !error ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
            <EmptyTitle>{t('empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      {selected && <RecommendedSkillInstallDialog skill={selected} onClose={() => setSelected(null)} />}
    </SettingSection>
  )
}
