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
    chipActive: "border-lime-300 bg-lime-50 text-lime-900 hover:bg-lime-100",
    chipInactive: "border-lime-200/70 bg-lime-50/40 text-lime-800/80 hover:bg-lime-50",
  },
  recording: {
    list: "border-rose-300/80 bg-rose-100 text-rose-900",
    chipActive: "border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100",
    chipInactive: "border-rose-200/70 bg-rose-50/40 text-rose-800/80 hover:bg-rose-50",
  },
  scan: {
    list: "border-cyan-300/80 bg-cyan-100 text-cyan-900",
    chipActive: "border-cyan-300 bg-cyan-50 text-cyan-900 hover:bg-cyan-100",
    chipInactive: "border-cyan-200/70 bg-cyan-50/40 text-cyan-800/80 hover:bg-cyan-50",
  },
  image: {
    list: "border-fuchsia-300/80 bg-fuchsia-100 text-fuchsia-900",
    chipActive: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900 hover:bg-fuchsia-100",
    chipInactive: "border-fuchsia-200/70 bg-fuchsia-50/40 text-fuchsia-800/80 hover:bg-fuchsia-50",
  },
  link: {
    list: "border-blue-300/80 bg-blue-100 text-blue-900",
    chipActive: "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100",
    chipInactive: "border-blue-200/70 bg-blue-50/40 text-blue-800/80 hover:bg-blue-50",
  },
  file: {
    list: "border-amber-300/80 bg-amber-100 text-amber-900",
    chipActive: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
    chipInactive: "border-amber-200/70 bg-amber-50/40 text-amber-800/80 hover:bg-amber-50",
  },
  todo: {
    list: "border-slate-300/80 bg-slate-200 text-slate-900",
    chipActive: "border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200",
    chipInactive: "border-slate-200/80 bg-slate-50/70 text-slate-700 hover:bg-slate-100",
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
