import type { Mark } from "@/db/marks"
import { cn } from "@/lib/utils"

export const MARK_TYPE_OPTIONS: Mark["type"][] = ['text', 'recording', 'scan', 'image', 'link', 'file', 'todo']

type MarkTypeTone = {
  list: string
  chipActive: string
  chipInactive: string
}

const MARK_TYPE_TONES: Record<Mark["type"], MarkTypeTone> = {
  text: {
    list: "border-lime-300/80 bg-lime-100 text-lime-900",
    chipActive: "border-lime-300 bg-lime-50 text-lime-900 hover:bg-lime-100 dark:border-lime-500/60 dark:bg-lime-500/18 dark:text-lime-200 dark:hover:bg-lime-500/24",
    chipInactive: "border-lime-200/70 bg-lime-50/40 text-lime-800/80 hover:bg-lime-50 dark:border-lime-500/35 dark:bg-lime-500/10 dark:text-lime-200/90 dark:hover:bg-lime-500/18",
  },
  recording: {
    list: "border-rose-300/80 bg-rose-100 text-rose-900",
    chipActive: "border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100 dark:border-rose-500/60 dark:bg-rose-500/18 dark:text-rose-200 dark:hover:bg-rose-500/24",
    chipInactive: "border-rose-200/70 bg-rose-50/40 text-rose-800/80 hover:bg-rose-50 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-200/90 dark:hover:bg-rose-500/18",
  },
  scan: {
    list: "border-cyan-300/80 bg-cyan-100 text-cyan-900",
    chipActive: "border-cyan-300 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:border-cyan-500/60 dark:bg-cyan-500/18 dark:text-cyan-200 dark:hover:bg-cyan-500/24",
    chipInactive: "border-cyan-200/70 bg-cyan-50/40 text-cyan-800/80 hover:bg-cyan-50 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-200/90 dark:hover:bg-cyan-500/18",
  },
  image: {
    list: "border-fuchsia-300/80 bg-fuchsia-100 text-fuchsia-900",
    chipActive: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900 hover:bg-fuchsia-100 dark:border-fuchsia-500/60 dark:bg-fuchsia-500/18 dark:text-fuchsia-200 dark:hover:bg-fuchsia-500/24",
    chipInactive: "border-fuchsia-200/70 bg-fuchsia-50/40 text-fuchsia-800/80 hover:bg-fuchsia-50 dark:border-fuchsia-500/35 dark:bg-fuchsia-500/10 dark:text-fuchsia-200/90 dark:hover:bg-fuchsia-500/18",
  },
  link: {
    list: "border-blue-300/80 bg-blue-100 text-blue-900",
    chipActive: "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-500/60 dark:bg-blue-500/18 dark:text-blue-200 dark:hover:bg-blue-500/24",
    chipInactive: "border-blue-200/70 bg-blue-50/40 text-blue-800/80 hover:bg-blue-50 dark:border-blue-500/35 dark:bg-blue-500/10 dark:text-blue-200/90 dark:hover:bg-blue-500/18",
  },
  file: {
    list: "border-amber-300/80 bg-amber-100 text-amber-900",
    chipActive: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/60 dark:bg-amber-500/18 dark:text-amber-200 dark:hover:bg-amber-500/24",
    chipInactive: "border-amber-200/70 bg-amber-50/40 text-amber-800/80 hover:bg-amber-50 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200/90 dark:hover:bg-amber-500/18",
  },
  todo: {
    list: "border-slate-300/80 bg-slate-200 text-slate-900",
    chipActive: "border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200 dark:border-slate-400/60 dark:bg-slate-400/20 dark:text-slate-100 dark:hover:bg-slate-400/28",
    chipInactive: "border-slate-200/80 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-400/35 dark:bg-slate-400/12 dark:text-slate-100/90 dark:hover:bg-slate-400/20",
  },
}

export function getMarkTypeChipClasses(type: Mark["type"], active: boolean) {
  return active ? MARK_TYPE_TONES[type].chipActive : MARK_TYPE_TONES[type].chipInactive
}

export function getMarkTypeListBadgeClasses(type: Mark["type"], textSize?: string) {
  return cn(
    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium",
    MARK_TYPE_TONES[type].list,
    textSize ? `text-${textSize}` : "text-xs"
  )
}
