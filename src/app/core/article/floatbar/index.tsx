'use client'
import Question from "./question";
import Polish from "./polish";
import Eraser from "./eraser";
import Expansion from "./expansion";
import ReadAloud from "./read-aloud";
import Vditor from "vditor";

export default function FloatBar({left, top, value, editor}: {left?: number, top?: number, value?: string, editor?: Vditor}) {
  return (
    left && top ? (
      <div
        className="absolute shadow rounded-lg bg-primary text-primary-foreground p-1"
        style={{left: left + 'px', top: top < 64 ? top + 82 + 'px' : top + 'px'}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Question editor={editor} value={value} />
            <Polish editor={editor} value={value} />
            <Eraser editor={editor} value={value} />
            <Expansion editor={editor} value={value} />
            <ReadAloud value={value} />
          </div>
        </div>
      </div>
    ) : null
  )
}