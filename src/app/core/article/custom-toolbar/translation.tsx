import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fetchAi } from "@/lib/ai";
import { Languages } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject } from "react";
import { locales } from "@/lib/locales";
import useArticleStore from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { TooltipButton } from "@/components/tooltip-button";
import useSettingStore from "@/stores/setting";
import { _t } from '@/locales/index';

export default function Translation({mdRef}: {mdRef: RefObject<ExposeParam>}) {
  const { loading, setLoading } = useArticleStore()
  const { apiKey } = useSettingStore()
  async function handleBlock(locale: string) {
    const selectedText = mdRef.current?.getSelectedText()
    if (selectedText) {
      setLoading(true)
      mdRef.current?.focus()
      const req = _t('translate_to_locale', selectedText, locale)
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild className="outline-none" disabled={loading || !apiKey}>
        <div>
          <TooltipButton tooltipText={_t('translate')} icon={<Languages />} disabled={loading || !apiKey} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{_t('select_text_for_translation')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {
            locales.map(item => (
              <DropdownMenuItem key={item} onClick={() => handleBlock(item)}>
                {item}
              </DropdownMenuItem>
            ))
          }
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
