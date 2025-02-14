import { TooltipButton } from "@/components/tooltip-button";
import { toast } from "@/hooks/use-toast";
import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { Sparkles } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { _t } from '@/locales/index';

export default function Optimize({mdRef}: {mdRef: RefObject<ExposeParam>}) {
  const { loading, setLoading } = useArticleStore()
  const { apiKey } = useSettingStore()
  async function handleBlock() {
    const selectedText = mdRef.current?.getSelectedText()
    if (selectedText) {
      setLoading(true)
      mdRef.current?.focus()
      const req = _t('optimize_text', selectedText);
      const res = await fetchAi(req)
      mdRef.current?.insert(() => ({
        targetValue: res,
      }))
      mdRef.current?.rerender();
      setLoading(false)
    } else {
      toast({
        title: _t('please_select_content'),
        variant: 'destructive'
      })
    }
  }
  return (
    <TooltipButton disabled={loading || !apiKey} icon={<Sparkles />} tooltipText={_t('optimize')} onClick={handleBlock}>
    </TooltipButton>
  )
}
