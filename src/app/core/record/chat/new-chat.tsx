"use client"

import { MessageSquarePlus } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useTagStore from "@/stores/tag"
import { insertTag } from "@/db/tags"
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
import { useState } from "react"
import { Input } from "@/components/ui/input"

export function NewChat() {
  const t = useTranslations('record.chat')
  const ct = useTranslations('common')
  const [name, setName] = useState('Untitled Chat')
  const {
    setCurrentTagId,
    getCurrentTag,
    fetchTags
  } = useTagStore()

  const { fetchMarks } = useMarkStore()
  const [open, setOpen] = useState(false)

  async function confirmCreateNewChat() {
    const res = await insertTag({ name })
    await setCurrentTagId(res.lastInsertId as number)
    await fetchTags()
    getCurrentTag()
    fetchMarks()
    setOpen(false)
    setName('Untitled Chat')
  }

  return (
    <>
      <TooltipButton icon={<MessageSquarePlus />} tooltipText={t('newChat')} onClick={() => setOpen(true)} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmNew')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmNewDescription')}
            </AlertDialogDescription>
            {/* 输入框 */}
            <div>
              <Input
                placeholder="Tag Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ct('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCreateNewChat}>{ct('confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
