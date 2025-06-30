import { TooltipButton } from "@/components/tooltip-button";
import { toast } from "@/hooks/use-toast";
import { fetchAiStreamToken } from "@/lib/ai";
import emitter from "@/lib/emitter";
import useArticleStore from "@/stores/article";
import useSettingStore from "@/stores/setting";
import { Sparkles } from "lucide-react";
import { useEffect } from "react";
import Vditor from "vditor";
import { useTranslations } from "next-intl";

export default function Polish({editor}: {editor?: Vditor}) {
  const { loading } = useArticleStore()
  const { primaryModel } = useSettingStore()
  const t = useTranslations('article.editor.toolbar.polish')
  async function handler() {
    const button = (editor?.vditor.toolbar?.elements?.polish.childNodes[0] as HTMLButtonElement)
    button.classList.add('vditor-menu--disabled')
    const selectedText = editor?.getSelection()
    if (selectedText) {
      const req = t('promptTemplate', {content: selectedText})
      await fetchAiStreamToken(req, (text) => {
        editor?.updateValue(text)
      })
      editor?.focus()
    } else {
      toast({
        title: t('selectContent'),
        variant: 'destructive'
      })
    }
    button.classList.remove('vditor-menu--disabled')
  }

  useEffect(() => {
    emitter.on('toolbar-polish', handler)
    return () => {
      emitter.off('toolbar-polish', handler)
    }
  }, [editor])

  return (
    <TooltipButton disabled={loading || !primaryModel} icon={<Sparkles />} tooltipText={t('tooltip')} onClick={handler}>
    </TooltipButton>
  )
}