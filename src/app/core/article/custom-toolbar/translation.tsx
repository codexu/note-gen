import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fetchAiTranslate } from "@/lib/ai";
import { useEffect, useState } from "react";
import emitter from "@/lib/emitter";
import { Languages } from "lucide-react";
import { locales } from "@/lib/locales";
import useArticleStore from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { TooltipButton } from "@/components/tooltip-button";
import useSettingStore from "@/stores/setting";
import Vditor from "vditor";
import { useTranslations } from "next-intl";

export default function Translation({editor}: {editor?: Vditor}) {
  const [open, setOpen] = useState(false)
  const { loading, setLoading } = useArticleStore()
  const { primaryModel } = useSettingStore()
  const [selectedText, setSelectedText] = useState('')
  const [range, setRange] = useState<Range | null>(null)
  const [offsetTop, setOffsetTop] = useState(0)
  const [offsetLeft, setOffsetLeft] = useState(0)
  const t = useTranslations('article.editor.toolbar.translation')

  function openHander(isOpen: boolean) {
    setOffsetTop(editor?.vditor.toolbar?.elements?.translation?.offsetTop || 0)
    setOffsetLeft(editor?.vditor.toolbar?.elements?.translation?.offsetLeft || 0)
    setOpen(isOpen)
    const preDom = document.querySelector('.vditor-reset') 
    const _range = document?.createRange()
    if (preDom && _range) {
      _range.selectNodeContents(preDom)
      setRange(_range)
    }
    if (isOpen) {
      setSelectedText(editor?.getSelection() || '')
    }
  }
  async function handleBlock(locale: string) {
    setOpen(false)
    if (selectedText) {
      setLoading(true)
      editor?.blur()
      const res = await fetchAiTranslate(selectedText, locale)
      setLoading(false)
      if (range) {
        const selection = document.getSelection()
        if (selection) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
      if(res && !res.includes('请求失败')){
        editor?.focus()
        editor?.insertValue(res)
      }
    } else {
      toast({
        title: t('selectContent'),
        variant: 'destructive'
      })
    }
  }

  useEffect(() => {
    emitter.on('toolbar-translation', () => {
      openHander(true)
    })
    return () => {
      emitter.off('toolbar-translation', () => {
        openHander(false)
      })
    }
  }, [editor])

  return (
    <DropdownMenu open={open} onOpenChange={openHander}>
      <DropdownMenuTrigger asChild className="outline-none" disabled={loading || !primaryModel}>
        <div>
          <TooltipButton tooltipText={t('tooltip')} icon={<Languages />} disabled={loading || !primaryModel} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 fixed" style={{ top: offsetTop + 32, left: offsetLeft }}>
        <DropdownMenuLabel>{t('description')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {
            locales.map(item => (
              <DropdownMenuItem key={item} onClick={(e) => {
                e.preventDefault()
                handleBlock(item)
              }}>
                {item}
              </DropdownMenuItem>
            ))
          }
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}