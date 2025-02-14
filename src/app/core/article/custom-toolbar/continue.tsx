import { TooltipButton } from "@/components/tooltip-button";
import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { ListPlus } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { _t } from '@/locales/index';

export default function Continue({mdRef}: {mdRef: RefObject<ExposeParam>}) {

  const { currentArticle, loading, setLoading } = useArticleStore()
  const { apiKey } = useSettingStore()
  async function handler() {
    const index = mdRef.current?.getEditorView()?.state.selection.ranges[0].to;
    setLoading(true)
    mdRef.current?.focus()
    const startContent = currentArticle.slice(0, index);
    const endContent = currentArticle.slice(index, currentArticle.length);
    const req = _t('continue_writing_prompt', startContent, endContent)
    const res = await fetchAi(req)
    mdRef.current?.insert(() => ({
      targetValue: res,
    }))
    setLoading(false)
  }
  return (
    <TooltipButton disabled={loading || !apiKey} icon={<ListPlus />} tooltipText={_t('continue_writing')} onClick={handler} />
  )
}
