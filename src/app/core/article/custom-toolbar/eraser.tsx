import { TooltipButton } from "@/components/tooltip-button";
import { toast } from "@/hooks/use-toast";
import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { EraserIcon } from "lucide-react";
import Vditor from "vditor";
import { useTranslations } from "next-intl";

export default function Eraser({editor}: {editor?: Vditor}) {
  const { loading, setLoading } = useArticleStore()
  const { primaryModel } = useSettingStore()
  const t = useTranslations('article.editor.toolbar.eraser')
  async function handleBlock() {
    const selectedText = editor?.getSelection()
    if (selectedText) {
      setLoading(true)
      editor?.focus()
      const req = t('promptTemplate', {content: selectedText})
      const res = await fetchAi(req)
      editor?.updateValue(res)
      setLoading(false)
    } else {
      toast({
        title: t('selectContent'),
        variant: 'destructive'
      })
    }
  }
  return (
    <TooltipButton disabled={loading || !primaryModel} icon={<EraserIcon />} tooltipText={t('tooltip')} onClick={handleBlock}>
    </TooltipButton>
  )
}