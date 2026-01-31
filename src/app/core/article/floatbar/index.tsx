'use client'
import Quote from "./quote";
import Polish from "./polish";
import Eraser from "./eraser";
import Expansion from "./expansion";
import ReadAloud from "./read-aloud";
import Vditor from "vditor";
import { useEffect, useRef, useState } from "react";

export default function FloatBar({left, top, value, editor}: {left?: number, top?: number, value?: string, editor?: Vditor}) {
  const floatBarRef = useRef<HTMLDivElement>(null)
  const [adjustedLeft, setAdjustedLeft] = useState(left)

  useEffect(() => {
    if (left !== undefined && floatBarRef.current) {
      const floatBarWidth = floatBarRef.current.offsetWidth
      const editorElement = document.getElementById('aritcle-md-editor')
      const editorWidth = editorElement?.clientWidth || 0
      
      // 检查是否超出右侧边界
      if (left + floatBarWidth > editorWidth) {
        // 靠右侧对齐，留一点边距
        setAdjustedLeft(editorWidth - floatBarWidth - 10)
      } else {
        setAdjustedLeft(left)
      }
    }
  }, [left])

  return (
    <div
      ref={floatBarRef}
      data-float-bar="true"
      className={`${(left && top ) ? 'block': 'hidden'} absolute shadow rounded-lg bg-primary text-primary-foreground p-1`}
      style={{left: adjustedLeft + 'px', top: (top || 0) < 64 ? (top || 0) + 82 + 'px' : (top || 0) + 'px'}}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Quote value={value} />
          <Polish editor={editor} value={value} />
          <Eraser editor={editor} value={value} />
          <Expansion editor={editor} value={value} />
          <ReadAloud value={value} />
        </div>
      </div>
    </div>
  )
}