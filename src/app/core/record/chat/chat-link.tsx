import { Link, Unlink } from "lucide-react"
import useMarkStore from '@/stores/mark'
import useTagStore from "@/stores/tag"
import useChatStore from "@/stores/chat"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"

export function ChatLink({ inputType }: { inputType?: string }) {
  const { currentTag } = useTagStore()
  const { marks } = useMarkStore()
  const { isLinkMark, setIsLinkMark } = useChatStore()
  const t = useTranslations('record.chat.input.tagLink')

  return (
    <TooltipButton
      icon={isLinkMark ? <Link /> : <Unlink />}
      tooltipText={isLinkMark ? `${t('on')} ${currentTag?.name}(${marks.length})` : t('off')}
      size="icon"
      disabled={marks.length === 0 || inputType === 'gen'}
      onClick={() => setIsLinkMark(!isLinkMark)}
    />  
  )
}