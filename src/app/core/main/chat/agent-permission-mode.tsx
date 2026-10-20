"use client"

import { Eye, ShieldCheck, ShieldQuestion } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ResponsiveActionMenu } from "@/components/responsive-action-menu"
import type { AgentPermissionMode } from "@/lib/agent/types"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"

const MODE_ICONS = {
  "read-only": Eye,
  ask: ShieldQuestion,
  "auto-edit": ShieldCheck,
} satisfies Record<AgentPermissionMode, typeof Eye>

const MODE_COLORS = {
  "read-only": "text-muted-foreground",
  ask: "text-warning-foreground",
  "auto-edit": "text-destructive",
} satisfies Record<AgentPermissionMode, string>

export function AgentPermissionModeSelect() {
  const t = useTranslations("record.chat.input.agent.permissionMode")
  const { agentPermissionMode, setAgentPermissionMode } = useSettingStore()
  const loading = useChatStore((state) => state.loading)
  const Icon = MODE_ICONS[agentPermissionMode]

  const handleChange = (value: string) => {
    if (value === "read-only" || value === "ask" || value === "auto-edit") {
      void setAgentPermissionMode(value)
    }
  }

  return (
    <ResponsiveActionMenu
      title={t("label")}
      desktopClassName="w-[30rem] max-w-[calc(100vw-2rem)]"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={t("label")}
        >
          <Icon data-icon="inline-start" className={MODE_COLORS[agentPermissionMode]} />
          <span className="hidden md:inline">{t(`modes.${agentPermissionMode}.title`)}</span>
        </Button>
      }
      items={(["read-only", "ask", "auto-edit"] as const).map(mode => {
        const ModeIcon = MODE_ICONS[mode]
        return {
          key: mode,
          icon: (
            <span className={MODE_COLORS[mode]}>
              <ModeIcon data-icon="inline-start" aria-hidden="true" />
            </span>
          ),
          multiline: true,
          label: (
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span>{t(`modes.${mode}.title`)}</span>
              <span className="text-xs leading-relaxed font-normal text-muted-foreground">{t(`modes.${mode}.description`)}</span>
            </span>
          ),
          selected: mode === agentPermissionMode,
          onSelect: () => handleChange(mode),
        }
      })}
    />
  )
}
