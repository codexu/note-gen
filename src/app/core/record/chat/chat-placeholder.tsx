import { Lightbulb, LightbulbOff } from "lucide-react"
import { useTranslations } from "next-intl"
import { TooltipButton } from "@/components/tooltip-button"
import { useEffect } from "react"
import { useLocalStorage } from 'react-use'
import useChatStore from "@/stores/chat"

export default function ChatPlaceholder() {
  const [storedValue, setStoredValue] = useLocalStorage('chat-placeholder-enabled', true)
  const { isPlaceholderEnabled, setPlaceholderEnabled } = useChatStore()
  const t = useTranslations('record.chat.input.placeholder')

  // Sync localStorage with the store on mount
  useEffect(() => {
    if (storedValue !== undefined && storedValue !== isPlaceholderEnabled) {
      setPlaceholderEnabled(!!storedValue)
    }
  }, [storedValue, isPlaceholderEnabled, setPlaceholderEnabled])

  const togglePlaceholder = () => {
    const newValue = !isPlaceholderEnabled
    setStoredValue(newValue)
    setPlaceholderEnabled(newValue)
  }

  return (
    <TooltipButton
      icon={isPlaceholderEnabled ? <Lightbulb className="size-4" /> : <LightbulbOff className="size-4" />}
      tooltipText={isPlaceholderEnabled ? t('on') : t('off')}
      size="icon"
      onClick={togglePlaceholder}
    />
  )
}