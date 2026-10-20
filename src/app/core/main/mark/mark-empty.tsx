import { Inbox } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function MarkEmpty() {
  const t = useTranslations()

  return (
    <Empty className="min-h-48">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{t('record.mark.empty')}</EmptyTitle>
        <EmptyDescription className="whitespace-pre-line text-xs">
          {t('record.mark.mark.emptyHint')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
