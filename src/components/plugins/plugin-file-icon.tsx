'use client'
import type { ReactNode } from 'react'
import { resolvePluginFileIcon, usePluginResources } from '@/lib/plugins/resources'
import { PluginIcon } from './plugin-icon'
export function PluginFileIcon({ path, kind = 'file', fallback, className = 'size-4 shrink-0' }: { path: string; kind?: 'file' | 'folder'; fallback: ReactNode; className?: string }) {
  usePluginResources(state => state.entries)
  usePluginResources(state => state.revision)
  const icon = resolvePluginFileIcon(path, kind)
  if (!icon) return fallback
  return 'emoji' in icon ? <span aria-hidden="true" className={className}>{icon.emoji}</span> : <PluginIcon name={icon.name} className={className} />
}
