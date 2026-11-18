'use client'

import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SkillContent } from '@/lib/skills/types'

interface SkillDetailViewProps {
  skillContent: SkillContent
}

export function SkillDetailView({ skillContent }: SkillDetailViewProps) {
  const t = useTranslations('article.file.folderView')
  const { metadata, instructions, scripts, references, assets } = skillContent

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-background gap-6 p-8 overflow-y-auto">
      {/* Skill Icon and Name */}
      <div className="flex flex-col items-center gap-3">
        <Sparkles className="w-20 h-20 text-ink" />
        <h2 className="text-2xl font-semibold tracking-tight">{metadata.name}</h2>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {metadata.description}
        </p>
      </div>

      {/* Skill Details */}
      <div className="flex flex-col gap-4 w-full max-w-2xl">
        {/* 指令 */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-sm">{t('instructions')}</h3>
          <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-60 overflow-y-auto">
            {instructions}
          </div>
        </div>

        {/* Scripts */}
        {scripts.length > 0 && (
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">{t('scripts')}</h3>
            <div className="text-sm space-y-2">
              {scripts.map((script) => (
                <div key={script.name} className="bg-muted/50 p-2 rounded">
                  <span className="font-medium">{script.name}</span>
                  {script.description && <span className="text-muted-foreground ml-2">: {script.description}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* References */}
        {references.length > 0 && (
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">{t('references')}</h3>
            <div className="text-sm space-y-2">
              {references.map((ref) => (
                <div key={ref.name} className="bg-muted/50 p-2 rounded">
                  <span className="font-medium">{ref.name}</span>
                  {ref.description && <span className="text-muted-foreground ml-2">: {ref.description}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assets */}
        {assets.length > 0 && (
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm">{t('assets')}</h3>
            <div className="text-sm space-y-2">
              {assets.map((asset) => (
                <div key={asset.name} className="bg-muted/50 p-2 rounded">
                  <span className="font-medium">{asset.name}</span>
                  {asset.description && <span className="text-muted-foreground ml-2">: {asset.description}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
