'use client'

import { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { useState, useCallback, useEffect } from 'react'
import { Search, X, ChevronDown, ChevronUp, Replace, ReplaceAll } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { isMobileDevice } from '@/lib/check'

// 搜索替换存储类型
interface SearchAndReplaceStorage {
  searchTerm: string
  replaceTerm: string
  results: { from: number; to: number }[]
  resultIndex: number
  caseSensitive: boolean
}

interface SearchReplacePanelProps {
  editor: Editor
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 获取搜索替换存储的辅助函数
function getSearchAndReplaceStorage(editor: Editor): SearchAndReplaceStorage | undefined {
  return (editor.storage as any).searchAndReplace
}

// 辅助函数来运行搜索替换命令
// 直接触发 transaction 来更新插件状态
function setSearchTerm(editor: Editor, term: string) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage) {
      storage.searchTerm = term
      editor.view.dispatch(editor.state.tr)
    }
  } catch {
    // 忽略错误
  }
}

function setReplaceTerm(editor: Editor, term: string) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage) {
      storage.replaceTerm = term
    }
  } catch {
    // 忽略错误
  }
}

function setSearchCaseSensitive(editor: Editor, value: boolean) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage) {
      storage.caseSensitive = value
    }
  } catch {
    // 忽略错误
  }
}

function nextResult(editor: Editor) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage && storage.results.length > 0) {
      const nextIndex = storage.resultIndex + 1
      storage.resultIndex = nextIndex >= storage.results.length ? 0 : nextIndex

      const result = storage.results[storage.resultIndex]
      if (result) {
        const sel = TextSelection.near(editor.state.doc.resolve(result.from))
        editor.view.dispatch(
          editor.state.tr.setSelection(sel)
        )
        setTimeout(() => {
          const domPos = editor.view.domAtPos(result.from)
          if (domPos.node instanceof Element) {
            domPos.node.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } else if (domPos.node.parentElement) {
            domPos.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 0)
      }
    }
  } catch {
    // 忽略错误
  }
}

function prevResult(editor: Editor) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage && storage.results.length > 0) {
      const prevIndex = storage.resultIndex - 1
      storage.resultIndex = prevIndex < 0 ? storage.results.length - 1 : prevIndex

      const result = storage.results[storage.resultIndex]
      if (result) {
        const sel = TextSelection.near(editor.state.doc.resolve(result.from))
        editor.view.dispatch(
          editor.state.tr.setSelection(sel)
        )
        setTimeout(() => {
          const domPos = editor.view.domAtPos(result.from)
          if (domPos.node instanceof Element) {
            domPos.node.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } else if (domPos.node.parentElement) {
            domPos.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 0)
      }
    }
  } catch {
    // 忽略错误
  }
}

function replaceCurrent(editor: Editor) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage && storage.results.length > 0 && storage.replaceTerm) {
      const { from, to } = storage.results[storage.resultIndex]
      editor.view.dispatch(
        editor.state.tr.insertText(storage.replaceTerm, from, to)
      )
      storage.searchTerm = storage.searchTerm
      editor.view.dispatch(editor.state.tr)
    }
  } catch {
    // 忽略错误
  }
}

function replaceAll(editor: Editor) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage && storage.results.length > 0 && storage.replaceTerm) {
      for (let i = storage.results.length - 1; i >= 0; i--) {
        const { from, to } = storage.results[i]
        editor.view.dispatch(
          editor.state.tr.insertText(storage.replaceTerm, from, to)
        )
      }
      storage.searchTerm = ''
      storage.results = []
      storage.resultIndex = 0
      editor.view.dispatch(editor.state.tr)
    }
  } catch {
    // 忽略错误
  }
}

// 直接清除搜索状态
function clearSearch(editor: Editor) {
  try {
    const storage = getSearchAndReplaceStorage(editor)
    if (storage) {
      storage.searchTerm = ''
      storage.results = []
      storage.resultIndex = 0
      editor.view.dispatch(editor.state.tr)
    }
  } catch {
    // 忽略错误
  }
}

export function SearchReplacePanel({ editor, open, onOpenChange }: SearchReplacePanelProps) {
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [resultCount, setResultCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const isMobile = isMobileDevice()

  // 更新搜索结果计数
  const updateResults = useCallback(() => {
    if (!editor) {
      setResultCount(0)
      setCurrentIndex(0)
      return
    }

    const storage = getSearchAndReplaceStorage(editor)
    const results = storage?.results || []
    const activeSearchTerm = storage?.searchTerm || ''

    if (!activeSearchTerm) {
      setResultCount(0)
      setCurrentIndex(0)
      return
    }

    setResultCount(results.length)
    setCurrentIndex(storage?.resultIndex || 0)
  }, [editor])

  // 监听编辑器状态变化
  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      updateResults()
    }

    editor.on('transaction', handleUpdate)
    return () => {
      editor.off('transaction', handleUpdate)
    }
  }, [editor, updateResults])

  // 替换当前
  const handleReplace = useCallback(() => {
    if (!editor) return
    replaceCurrent(editor)
    updateResults()
  }, [editor, updateResults])

  // 替换全部
  const handleReplaceAll = useCallback(() => {
    if (!editor) return
    replaceAll(editor)
    updateResults()
  }, [editor, updateResults])

  // 查找上一个
  const handlePrev = useCallback(() => {
    if (!editor) return
    prevResult(editor)
    updateResults()
  }, [editor, updateResults])

  // 查找下一个
  const handleNext = useCallback(() => {
    if (!editor) return
    nextResult(editor)
    updateResults()
  }, [editor, updateResults])

  // 关闭面板时清除搜索
  const handleClose = useCallback(() => {
    if (editor) {
      clearSearch(editor)
    }
    setSearchText('')
    setReplaceText('')
    onOpenChange(false)
  }, [editor, onOpenChange])

  // 搜索文本变化
  const handleSearchChange = useCallback((value: string) => {
    setSearchText(value)
    if (editor && value) {
      setSearchTerm(editor, value)
    } else if (editor) {
      setSearchTerm(editor, '')
    }
    setTimeout(() => {
      updateResults()
    }, 0)
  }, [editor, updateResults])

  // 替换文本变化
  const handleReplaceChange = useCallback((value: string) => {
    setReplaceText(value)
    if (editor) {
      setReplaceTerm(editor, value)
    }
  }, [editor])

  // 大小写切换
  const handleCaseSensitiveToggle = useCallback(() => {
    const newValue = !caseSensitive
    setCaseSensitive(newValue)
    if (editor) {
      setSearchCaseSensitive(editor, newValue)
      if (searchText) {
        setSearchTerm(editor, searchText)
      }
    }
    updateResults()
  }, [editor, caseSensitive, searchText, updateResults])

  if (!open) return null

  const panelContent = (
    <>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="searchAndReplace-replace-input"
            placeholder="搜索..."
            value={searchText}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) {
                  handlePrev()
                } else {
                  handleNext()
                }
              } else if (e.key === 'Escape') {
                handleClose()
              }
            }}
            className="pl-8 pr-16"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground">
            {resultCount > 0 ? (
              <span>
                {currentIndex + 1}/{resultCount}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={handlePrev}
          disabled={resultCount === 0}
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={handleNext}
          disabled={resultCount === 0}
          title="下一个 (Enter)"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={handleClose}
          title="关闭 (Esc)"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <div className="relative flex-1">
          <Replace className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="替换为..."
            value={replaceText}
            onChange={(e) => handleReplaceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) {
                  handleReplaceAll()
                } else {
                  handleReplace()
                }
              }
            }}
            className="pl-8 pr-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReplace}
          disabled={resultCount === 0}
          title="替换当前 (Enter)"
        >
          <Replace className="w-3 h-3 mr-1" />
          替换
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReplaceAll}
          disabled={resultCount === 0}
          title="替换全部 (Shift+Enter)"
        >
          <ReplaceAll className="w-3 h-3 mr-1" />
          全部
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-2 pt-1">
        <label className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground cursor-pointer hover:bg-muted/50">
          <Checkbox
            checked={caseSensitive}
            onCheckedChange={handleCaseSensitiveToggle}
          />
          <span>区分大小写</span>
        </label>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerHeader>
            <DrawerTitle>搜索和替换</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            {panelContent}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-background border border-border rounded-lg shadow-lg p-3 min-w-96">
        {panelContent}
      </div>
    </div>
  )
}
