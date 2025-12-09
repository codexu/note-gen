'use client'

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
    <div className="flex-1 overflow-y-auto">
      <div className="px-0">
        <div>
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
        </div>
      </div>
    </div>
  )
}