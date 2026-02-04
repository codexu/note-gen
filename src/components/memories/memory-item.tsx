'use client'

import { useTranslations } from 'next-intl'
import { Memory } from '@/db/memories'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface MemoryItemProps {
  memory: Memory
  onDelete: () => void
}

export function MemoryItem({ memory, onDelete }: MemoryItemProps) {
  const t = useTranslations('settings.memories')

  const categoryLabel = memory.category === 'preference' ? t('preference') : t('knowledge')
  const categoryVariant = memory.category === 'preference' ? 'default' : 'secondary'

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={categoryVariant as any}>{categoryLabel}</Badge>
              {memory.replacedId && (
                <Badge variant="outline" className="text-xs">
                  {t('replaced')}
                </Badge>
              )}
            </div>

            <p className="text-sm">{memory.content}</p>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                {formatDistanceToNow(memory.updatedAt, {
                  addSuffix: true,
                  locale: zhCN,
                })}
              </span>
              <span>{t('accessCount', { count: memory.accessCount })}</span>
            </div>
          </div>

          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
