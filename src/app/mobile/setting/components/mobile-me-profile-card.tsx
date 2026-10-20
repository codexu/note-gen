'use client'

import { Cloud, HardDrive, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

interface MobileMeProfileCardProps {
  name: string
  avatarUrl?: string
  syncStatus: string
  providerName?: string
  providerType: 'git' | 'storage' | 'unconfigured'
}

export function MobileMeProfileCard({
  name,
  avatarUrl = '',
  syncStatus,
  providerName,
  providerType,
}: MobileMeProfileCardProps) {
  const initials = name.trim().slice(0, 1).toUpperCase() || 'N'
  const leadingIcon = providerType === 'storage'
    ? <HardDrive className="size-5" />
    : providerType === 'unconfigured'
      ? <Cloud className="size-5" />
      : <User className="size-5" />
  const isGit = providerType === 'git'
  const isStorage = providerType === 'storage'
  const isUnconfigured = providerType === 'unconfigured'

  return (
    <section
      className={cn(
        "mobile-dock-surface rounded-[1.35rem] p-4 transition-colors",
        isGit && "border-emerald-200/70 dark:border-emerald-900/70",
        isStorage && "border-sky-200/70 dark:border-sky-900/70",
        isUnconfigured && "border-amber-200/70 dark:border-amber-900/70"
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar
          className={cn(
            "size-14 border",
            isGit && "border-emerald-200/80 dark:border-emerald-800/80",
            isStorage && "border-sky-200/80 dark:border-sky-800/80",
            isUnconfigured && "border-amber-200/80 dark:border-amber-800/80"
          )}
        >
          <AvatarImage src={avatarUrl} alt={name} />
          <AvatarFallback
            className={cn(
              "text-primary",
              isGit && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200",
              isStorage && "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200",
              isUnconfigured && "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200"
            )}
          >
            {avatarUrl ? initials : leadingIcon}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {providerName ? (
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs",
                  isGit && "border-emerald-200 bg-emerald-100/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                  isStorage && "border-sky-200 bg-sky-100/80 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                )}
              >
                {providerName}
              </Badge>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                isGit && "border-emerald-200 bg-emerald-100/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                isStorage && "border-sky-200 bg-sky-100/80 text-sky-700 dark:border-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
                isUnconfigured && "border-amber-200 bg-amber-100/80 text-amber-700 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              )}
            >
              {syncStatus}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
