'use client'

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
} from "@/components/ui/sidebar"
import { useTranslations } from 'next-intl'
import React from "react"
import { TagManage } from './tag-manage'
import { MarkHeader } from './mark-header'
import { MarkList } from './mark-list'
import { MarkToolbar } from './mark-toolbar'
import useMarkStore from "@/stores/mark"
import { Button } from "@/components/ui/button"
import { clearTrash } from "@/db/marks"
import { confirm } from '@tauri-apps/plugin-dialog';

export function NoteSidebar() {
  const t = useTranslations();
  const { trashState, marks, setMarks } = useMarkStore()

  async function handleClearTrash() {
    const res = await confirm(t('record.trash.confirm'), {
      title: t('record.trash.title'),
      kind: 'warning',
    })
    if (res) {
      await clearTrash()
      setMarks([])
    }
  }

  return (
    <Sidebar id="record-sidebar" collapsible="none" className="w-full h-screen hidden md:flex flex-col">
      <SidebarHeader className="p-0">
        <MarkHeader />
      </SidebarHeader>
      
      {trashState ? (
        <>
          <div className="flex p-2 border-b items-center justify-between">
            <p className="text-xs text-zinc-500">{t('record.trash.records', { count: marks.length })}</p>
            {marks.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearTrash}>
                {t('record.trash.empty')}
              </Button>
            )}
          </div>
          <MarkList />
        </>
      ) : (
        <SidebarContent className="flex-1 overflow-y-auto">
          <TagManage />
        </SidebarContent>
      )}
      
      <MarkToolbar />
    </Sidebar>
  )
}