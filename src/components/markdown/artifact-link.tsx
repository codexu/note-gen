'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/hooks/use-toast'
import { isMobileDevice } from '@/lib/check'
import { ChatArtifactError, openChatArtifact, saveChatArtifactAs } from '@/lib/chat-artifacts'
import type { AgentArtifactPaths } from '@/lib/agent/artifacts'
import { ARTIFACT_LINK_PREFIX } from './remark-artifacts'

export const EMPTY_ARTIFACT_LINKS: AgentArtifactPaths = { artifacts: [], allowedPaths: [], paths: {} }
export const ArtifactLinksContext = createContext<AgentArtifactPaths>(EMPTY_ARTIFACT_LINKS)

export function ArtifactLink({ index, href, children }: { index: number; href: string; children: ReactNode }) {
  const t = useTranslations('record.chat.artifacts')
  const links = useContext(ArtifactLinksContext)
  const artifact = links.artifacts[index]
  const [pending, setPending] = useState<'open' | 'save' | null>(null)
  const pendingRef = useRef(false)
  const mobile = isMobileDevice()
  if (!artifact) return <>{children}</>

  const name = artifact.path.split('/').pop() || artifact.path
  const context = { allowedPaths: links.allowedPaths }
  const act = async (action: 'open' | 'save') => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(action)
    try {
      if (action === 'open') await openChatArtifact(artifact.absolutePath, context)
      else if (await saveChatArtifactAs(artifact.absolutePath, context)) toast({ title: t('saved') })
    } catch (error) {
      const errorKey = error instanceof ChatArtifactError ? `errors.${error.code}` : ''
      toast({
        title: t(action === 'open' ? 'openFailed' : 'saveFailed'),
        description: errorKey && t.has(errorKey) ? t(errorKey) : t('actionFailed'),
        variant: 'destructive',
      })
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  return (
    <span className="inline-flex max-w-full items-baseline gap-1 align-baseline">
      <a
        href={href}
        className="min-w-0 text-primary underline underline-offset-4"
        aria-label={t('open', { name })}
        aria-disabled={pending !== null || mobile}
        title={mobile ? t('desktopOnly') : artifact.partial ? t('partialHint') : t('open', { name })}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          if (!mobile) void act('open')
        }}
      >
        {children || name}
      </a>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending !== null || mobile}
            aria-label={t('saveAs', { name })}
            onClick={event => { event.preventDefault(); event.stopPropagation(); void act('save') }}
          >
            {pending === 'save' ? <Spinner /> : <Download />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{mobile ? t('desktopOnly') : t('saveAs', { name })}</TooltipContent>
      </Tooltip>
    </span>
  )
}

export function artifactLinkIndex(href: string | undefined): number | null {
  if (!href?.startsWith(ARTIFACT_LINK_PREFIX)) return null
  const value = href.slice(ARTIFACT_LINK_PREFIX.length)
  return /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : null
}
