'use client'

import {
  Sidebar,
  SidebarHeader,
} from "@/components/ui/sidebar"
import React from "react"
import { TagManage } from './tag'
import { MarkToolbar } from './mark/mark-toolbar'
import { MarkList } from './mark/mark-list'
import useMarkStore from "@/stores/mark"
import { Button } from "@/components/ui/button"
import { clearTrash } from "@/db/marks"
import { confirm } from '@tauri-apps/plugin-dialog';
import { _t } from '@/locales';

export function NoteSidebar() {
  const { trashState, marks, setMarks } = useMarkStore()

  async function handleClearTrash() {
    const res = await confirm(_t('clear_trash_confirm_message'), {
      title: _t('clear_trash_title'),
      kind: 'warning',
    })
    if (res) {
      await clearTrash()
      setMarks([])
    }
  }

  return (
    <Sidebar collapsible="none" className="border-r w-[280px]">
      <SidebarHeader className="p-0">
        <MarkToolbar />
        {
          trashState?
          <div className="flex pb-2 relative border-b h-6 items-center justify-center">
            <p className="absolute text-xs text-zinc-500">{_t('trash_records_count', marks.length)}</p>
            {
              marks.length > 0 ?
              <Button className="text-xs text-red-900 right-8 absolute" variant="link" onClick={handleClearTrash}>{_t('clear_trash_action')}</Button> : null
            }
          </div> :
          <TagManage />
        }
      </SidebarHeader>
      <MarkList />
    </Sidebar>
  )
}
