"use client"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Trash } from "lucide-react"
import * as React from "react"
import { initMarksDb } from "@/db/marks"
import { ControlScan } from "./control-scan"
import { ControlText } from "./control-text"
import { ControlImage } from "./control-image"
import { ControlFile } from "./control-file"
import { Toggle } from "@/components/ui/toggle"
import useMarkStore from "@/stores/mark"
import { _t } from '@/locales';

export function MarkToolbar() {

  const { trashState, setTrashState, fetchAllTrashMarks, fetchMarks } = useMarkStore()

  React.useEffect(() => {
    initMarksDb()
  }, [])

  React.useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchMarks()
    }
  }, [trashState])

  return (
    <div className="flex justify-between items-center h-12 border-b px-2">
      <div className="flex">
        <TooltipProvider>
          <ControlScan />
          <ControlImage />
          <ControlFile />
          <ControlText />
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Toggle
                asChild
                aria-label="Toggle trash"
                className="data-[state=on]:bg-secondary-foreground data-[state=on]:text-secondary"
                pressed={trashState}
                onPressedChange={setTrashState}
                size={"sm"}
              >
                <div>
                  <Trash className="size-4" />
                </div>
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>
              <p>{_t('trash_tooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
