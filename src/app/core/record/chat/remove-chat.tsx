"use client"

import { Trash2 } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useTagStore from "@/stores/tag"
import { delTag } from "@/db/tags"
import useMarkStore from "@/stores/mark"
import { useTranslations } from "next-intl"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useEffect, useState } from "react"

export function RemoveChat() {
  const t = useTranslations('record.chat')
  const ct = useTranslations('common')
  const {
    tags,
    setCurrentTagId,
    currentTag,
    getCurrentTag,
    fetchTags
  } = useTagStore()

  const { fetchMarks } = useMarkStore()
  const [open, setOpen] = useState(false)
  const [isFirstTag, setIsFirstTag] = useState(false)

  useEffect(() => {
    if (tags?.length === 0) {
      setIsFirstTag(true)
    } else {
      setIsFirstTag(currentTag?.id === tags?.[0].id)
    }
  }, [currentTag, tags])

  async function confirmRemoveChat() {
    await delTag(currentTag?.id as number)
    await fetchTags()
    await setCurrentTagId(tags?.[0].id as number)
    getCurrentTag()
    fetchMarks()
    setOpen(false)
  }

  return (
    <>
      <TooltipButton disabled={isFirstTag} icon={<Trash2 />} tooltipText={t('removeChat')} onClick={() => setOpen(true)} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmRemove')}</AlertDialogTitle>
            <AlertDialogDescription className="text-red-500">
              {t('confirmRemoveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ct('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveChat}>{ct('confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
