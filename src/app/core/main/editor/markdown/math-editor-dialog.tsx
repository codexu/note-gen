'use client'

import { useState, useEffect, useMemo } from 'react'
import katex from 'katex'
import { Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface MathEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (latex: string, type: 'inline' | 'block') => void
  initialLatex?: string
  type: 'inline' | 'block'
  title?: string
}

export function MathEditorDialog({
  open,
  onOpenChange,
  onInsert,
  initialLatex = '',
  type = 'inline',
  title = '插入公式',
}: MathEditorDialogProps) {
  const [latex, setLatex] = useState(initialLatex)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLatex(initialLatex)
    }
  }, [open, initialLatex])

  const renderedHtml = useMemo(() => {
    try {
      setError(null)
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: type === 'block',
      })
    } catch (e) {
      setError((e as Error).message)
      return `<span class="text-red-500">Invalid LaTeX</span>`
    }
  }, [latex, type])

  const handleInsert = () => {
    if (!latex.trim()) return
    onInsert(latex, type)
    onOpenChange(false)
    setLatex('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleInsert()
    }
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma className="w-5 h-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">LaTeX 公式</label>
            <Input
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入 LaTeX 公式，例如: \frac{a}{b}"
              className="font-mono"
            />
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">预览</label>
            <div
              className={`min-h-[80px] p-4 rounded-lg border bg-muted/30 overflow-x-auto ${
                type === 'block' ? 'text-center' : ''
              }`}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p>常用公式示例:</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>分数: <code>\frac&#123;a&#125;&#123;b&#125;</code></li>
              <li>上标: <code>x^2</code></li>
              <li>下标: <code>x_n</code></li>
              <li>平方根: <code>\sqrt&#123;x&#125;</code></li>
              <li>求和: <code>\sum_&#123;i=1&#125;^n</code></li>
              <li>积分: <code>\int_a^b f(x) dx</code></li>
              <li>极限: <code>\lim_&#123;x \to \infty&#125;</code></li>
              <li>希腊字母: <code>\alpha, \beta, \pi</code></li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleInsert} disabled={!latex.trim()}>
            插入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
