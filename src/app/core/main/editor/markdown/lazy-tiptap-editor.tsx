'use client'

import dynamic from 'next/dynamic'
import { Spinner } from '@/components/ui/spinner'

export const LazyTipTapEditor = dynamic(
  () => import('./tiptap-editor').then(module => module.TipTapEditor),
  { ssr: false, loading: () => <Spinner className="m-auto text-muted-foreground" /> },
)
