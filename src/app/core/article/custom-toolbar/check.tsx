import { TooltipButton } from "@/components/tooltip-button";
import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { SquareActivity } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { cursorDocEnd, insertNewline, blockComment } from "@codemirror/commands";
import { _t } from '@/locales/index';

export default function Check({mdRef}: {mdRef: RefObject<ExposeParam>}) {

  const { currentArticle, loading, setLoading } = useArticleStore()
  const { apiKey } = useSettingStore()
  async function handler() {
    setLoading(true)
    mdRef.current?.focus()
    const codemirror = mdRef.current?.getEditorView()
    if (!codemirror) return
    cursorDocEnd(codemirror)
    insertNewline(codemirror)
    insertNewline(codemirror)
    const req = _t('analyze_article_prompt', currentArticle)
    const res = (await fetchAi(req))

    mdRef.current?.insert(() => ({
      targetValue: res,
    }))

    blockComment(codemirror)
    setLoading(false)
  }
  return (
    <TooltipButton disabled={loading || !apiKey} icon={<SquareActivity />} tooltipText={_t('analyze')} onClick={handler}>
    </TooltipButton>
  )
}
