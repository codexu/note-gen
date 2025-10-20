import { fetchAi } from "@/lib/ai";
import useArticleStore from "@/stores/article";
import { Highlighter, Plus, ChevronDown, Tag } from "lucide-react";
import { MarkWrapper } from "../../record/mark/mark-item";
import { MarkLoading } from "../../record/mark/mark-loading";
import useMarkStore from "@/stores/mark";
import { Button } from "@/components/ui/button";
import { Mark, delMark } from "@/db/marks";
import { TooltipButton } from "@/components/tooltip-button";
import useSettingStore from "@/stores/setting";
import Vditor from "vditor";
import { useEffect, useState, useMemo } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import emitter from "@/lib/emitter";
import { useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import useTagStore from "@/stores/tag";

export default function MarkInsert({editor}: {editor?: Vditor}) {
  const [open, setOpen] = useState(false)
  const [openTags, setOpenTags] = useState<Record<number, boolean>>({})
  const { loading, setLoading } = useArticleStore()
  const { primaryModel } = useSettingStore()
  const { allMarks, queues, fetchAllMarks } = useMarkStore()
  const { tags } = useTagStore()
  const t = useTranslations('article.editor.toolbar.mark')

  // Group marks by tag
  const marksByTag = useMemo(() => {
    const grouped: Record<number, Mark[]> = {}
    allMarks.forEach(mark => {
      if (!grouped[mark.tagId]) {
        grouped[mark.tagId] = []
      }
      grouped[mark.tagId].push(mark)
    })
    return grouped
  }, [allMarks])

  // Toggle tag collapse state
  const toggleTag = (tagId: number) => {
    setOpenTags(prev => ({ ...prev, [tagId]: !prev[tagId] }))
  }

  // Initialize all tags as open when marks are loaded
  useEffect(() => {
    if (Object.keys(marksByTag).length > 0) {
      const initialState: Record<number, boolean> = {}
      Object.keys(marksByTag).forEach(tagId => {
        initialState[Number(tagId)] = true
      })
      setOpenTags(initialState)
    }
  }, [marksByTag])

  async function handleBlock(mark: Mark) {
    setLoading(true)
    await delMark(mark.id)
    // Refresh the marks list to update UI
    await fetchAllMarks()
    editor?.focus()
    switch (mark.type) {
      case 'text':
        editor?.insertValue(mark.content || '')
        break;
      case 'image':
        editor?.insertValue(`![${mark.desc}](${mark.url})`)
        break;
      default:
        if (primaryModel) {
          const req = `这是一段 OCR 识别的结果：${mark.content}进行整理，直接返回整理后的结果。`
          const res = await fetchAi(req)
          editor?.insertValue(res)
        } else {
          editor?.insertValue(mark.content || t('ocrNoContent'))
        }
        break;
    }
    setLoading(false)
  }

  async function openChangeHandler(e: boolean) {
    setOpen(e)
    if (e) {
      fetchAllMarks()
      // Fetch tags to ensure we have the latest tag data
      const { fetchTags } = useTagStore.getState()
      await fetchTags()
    }
  }

  useEffect(() => {
    emitter.on('toolbar-mark', () => {
      openChangeHandler(true)
    })
    return () => {
      emitter.off('toolbar-mark', () => {
        openChangeHandler(false)
      })
    }
  }, [editor])

  return (
    <Sheet open={open} onOpenChange={openChangeHandler}>
      <SheetTrigger asChild>
        <div>
          <TooltipButton tooltipText={t('tooltip')} icon={<Highlighter />} disabled={loading} />
        </div>
      </SheetTrigger>
      <SheetContent className="p-0 min-w-full md:min-w-[500px] flex flex-col">
        <SheetHeader className="p-4 border-b flex-shrink-0">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {
            queues.map(mark => {
              return (
                <MarkLoading key={mark.queueId} mark={mark} />
              )
            })
          }
          {
            allMarks.length ? (
              // Sort tags by sortOrder before rendering
              tags
                .filter(tag => marksByTag[tag.id] && marksByTag[tag.id].length > 0)
                .map(tag => {
                  const marks = marksByTag[tag.id]
                  
                  return (
                    <Collapsible
                      key={tag.id}
                      open={openTags[tag.id]}
                      onOpenChange={() => toggleTag(tag.id)}
                      className="border-b"
                    >
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-2">
                            <Tag className="size-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{tag.name}</span>
                            <span className="text-xs text-muted-foreground">({marks.length})</span>
                          </div>
                          <ChevronDown 
                            className={`size-4 transition-transform ${
                              openTags[tag.id] ? 'rotate-180' : ''
                            }`}
                          />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {
                          marks.map((mark) => (
                            <div key={mark.id} className="flex items-center border-t first:border-t-0">
                              <Button 
                                className="size-12 ml-2 flex-shrink-0" 
                                onClick={() => handleBlock(mark)}
                                variant="ghost"
                              >
                                <Plus />
                              </Button>
                              <MarkWrapper mark={mark} />
                            </div>
                          ))
                        }
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })
            ) : (
              <div className="flex items-center justify-center text-zinc-500 text-xs text-center h-48">
                {t('noRecords')}
              </div>
            )
          }
        </div>
      </SheetContent>
    </Sheet>
  )
}