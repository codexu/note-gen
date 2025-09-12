'use client'

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import React from "react"
import { MarkItem } from "./mark-item";
import useMarkStore from "@/stores/mark";
import { MarkLoading } from "./mark-loading";
import MarkEmpty from "./mark-empty";
export function MarkList() {
  const { 
    marks, 
    queues
  } = useMarkStore()

  return (
    <SidebarContent className="flex-1">
      <SidebarGroup className="px-0">
        <SidebarGroupContent>
          {
            queues.map(mark => {
              return (
                <MarkLoading key={mark.queueId} mark={mark} />
              )
            })
          }
          {
            marks.length ? (
              marks.map((mark) => (
                <MarkItem key={mark.id} mark={mark} />
              ))
            ) : <MarkEmpty />
          }
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}