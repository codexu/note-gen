'use client'

import { forwardRef } from 'react'
import { LibraryBig, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWikiWorking } from './use-wiki-working'

/** All Wiki surfaces share live execution state without reading SQLite per icon. */
export const WikiFolderIcon = forwardRef<SVGSVGElement, LucideProps>(function WikiFolderIcon({ className, ...props }, ref) {
  const working = useWikiWorking()

  return <LibraryBig {...props} ref={ref} className={cn('notegen-wiki-icon', className)} data-wiki-working={working || undefined} />
})
