'use client'

import { useEffect, useState } from 'react'
import { Link } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getRecordImageSrc } from '@/app/core/main/mark/record-image-asset'
import { LocalImage } from '@/components/local-image'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import type { Mark } from '@/db/marks'
import { isHttpUrl } from '@/lib/utils'

interface MobileRecordContentProps {
  mark: Mark
  imageCaption: string
  isActive: boolean
  busy: boolean
  save: (apply: (latest: Mark) => Mark, options?: { debounce?: boolean }) => Promise<boolean>
}

const inlineInputClass = 'h-11 border-0 bg-transparent! px-0 focus-visible:ring-1 md:text-base'

function RecordImage({ src, alt, isActive }: { src: string; alt: string; isActive: boolean }) {
  const t = useTranslations('record.mark.detail')
  const [open, setOpen] = useState(false)

  useEffect(() => { if (!isActive) setOpen(false) }, [isActive])

  return (
    <Dialog open={isActive && open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t('previewImage')}
          className="flex min-h-11 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border bg-muted/20 focus-visible:outline-ring"
        >
          <LocalImage src={src} alt={alt} className="h-auto max-h-[55svh] w-full object-contain" />
        </button>
      </DialogTrigger>
      <DialogContent className="p-2 sm:min-w-0 sm:max-w-2xl [&>[data-slot=dialog-close]]:size-11" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t('previewImage')}</DialogTitle>
        <LocalImage src={src} alt={alt} loading="eager" className="h-auto max-h-[84svh] w-full rounded-lg object-contain" />
      </DialogContent>
    </Dialog>
  )
}

export function getLinkDomain(url: string) {
  if (!isHttpUrl(url)) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function MobileRecordContent({ mark, imageCaption, isActive, busy, save }: MobileRecordContentProps) {
  const t = useTranslations()
  const readOnly = mark.deleted === 1

  if (mark.type === 'text') return null

  const url = mark.url?.trim() ?? ''
  const hasLink = mark.type === 'link' && (!readOnly || Boolean(url))
  const domain = hasLink ? getLinkDomain(url) : ''
  const imageSrc = getRecordImageSrc(mark)
  if (!imageSrc && !hasLink) return null

  return (
    <FieldGroup className="gap-2">
      {imageSrc ? (
        <figure className="flex min-w-0 flex-col gap-2">
          <RecordImage src={imageSrc} alt={t(`record.mark.type.${mark.type}`)} isActive={isActive} />
          {imageCaption ? <figcaption className="wrap-break-word whitespace-pre-wrap text-sm leading-snug text-muted-foreground">{imageCaption}</figcaption> : null}
        </figure>
      ) : null}
      {hasLink ? (
        <Item size="xs" className="min-w-0 flex-nowrap px-0 py-0">
          <ItemMedia variant="icon" className="text-muted-foreground" aria-hidden="true">
            <Link />
          </ItemMedia>
          <ItemContent className="min-w-0">
            {domain ? <ItemTitle className="block w-full truncate" title={url}>{domain}</ItemTitle> : null}
            {!readOnly ? (
              <Input
                aria-label={t('record.mark.detail.linkUrl')}
                placeholder={t('record.mark.detail.linkUrl')}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={inlineInputClass}
                value={mark.url ?? ''}
                readOnly={busy}
                onChange={(event) => {
                  const url = event.target.value
                  void save(latest => ({ ...latest, url }), { debounce: true })
                }}
              />
            ) : <span className="wrap-break-word text-xs text-muted-foreground">{url}</span>}
          </ItemContent>
        </Item>
      ) : null}
    </FieldGroup>
  )
}
