import { TooltipButton } from "@/components/tooltip-button";
import { toast } from "@/hooks/use-toast";
import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { MessageCircleQuestion } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { _t } from '@/locales/index';

export default function Question({mdRef}: {mdRef: RefObject<ExposeParam>}) {

  const { currentArticle, loading, setLoading } = useArticleStore()
  const { apiKey } = useSettingStore()
  
  async function handleBlock() {
    const selectedText = mdRef.current?.getSelectedText()
    if (selectedText) {
      setLoading(true)
      mdRef.current?.focus()
      const req = `
        _t('reference_original_text')${currentArticle}
        _t('according_to_question')${selectedText}，_t('directly_return_answer')
      `
      const res = await fetchAi(req)
      mdRef.current?.insert(() => ({
        targetValue: res,
      }))
      setLoading(false)
    } else {
      toast({
        title: _t('please_select_content'),
        variant: 'destructive'
      })
    }
  }
  return (
    <TooltipButton disabled={loading || !apiKey} icon={<MessageCircleQuestion />} tooltipText={_t('qa')} onClick={handleBlock}>
    </TooltipButton>
  )
}
