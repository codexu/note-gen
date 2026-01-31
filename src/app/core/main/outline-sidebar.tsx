'use client'

import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import useArticleStore from '@/stores/article'
import emitter from '@/lib/emitter'

interface HeadingNode {
  id: string
  level: number
  text: string
  children: HeadingNode[]
}

// 大纲节点组件
function OutlineNode({ node, level = 0 }: { node: HeadingNode; level?: number }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasChildren = node.children.length > 0

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // 跳转到对应的标题
    const element = document.getElementById(node.id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(!isExpanded)
  }

  return (
    <div>
      <div
        className="flex items-center py-1.5 px-2 rounded cursor-pointer hover:bg-accent transition-colors"
        style={{ marginLeft: `${level * 16}px` }}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span
            onClick={handleToggle}
            className="shrink-0 mr-1"
            style={{
              transition: 'transform 0.2s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
            }}
          >
            <ChevronRight size={14} />
          </span>
        ) : (
          <span className="inline-block w-5 shrink-0" />
        )}
        <span
          className="text-sm"
          style={{
            fontWeight: node.level === 1 ? '600' : '400',
            fontSize: node.level === 1 ? '15px' : '14px'
          }}
        >
          {node.text}
        </span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map(child => (
            <OutlineNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function OutlineSidebar() {
  const { currentArticle, activeFilePath } = useArticleStore()
  const [tree, setTree] = useState<HeadingNode[]>([])

  // 构建标题树
  const buildHeadingTree = (headings: HTMLElement[]): HeadingNode[] => {
    const root: HeadingNode[] = []
    const stack: { node: HeadingNode; level: number }[] = []

    headings.forEach((heading) => {
      const element = heading as HTMLElement

      // 获取标题级别
      let level = 1
      const dataLevel = element.dataset.level
      if (dataLevel) {
        level = parseInt(dataLevel)
      } else {
        const tagName = element.tagName.toLowerCase()
        if (tagName.startsWith('h')) {
          level = parseInt(tagName.substring(1))
        }
      }

      // 获取标题文本
      let text = ''
      const clone = element.cloneNode(true) as HTMLElement
      const marker = clone.querySelector('.vditor-ir__marker--heading')
      if (marker) {
        marker.remove()
      }
      text = clone.textContent?.trim() || element.textContent?.replace(/^#+\s*/, '').trim() || ''

      const id = element.id
      const node: HeadingNode = { id, level, text, children: [] }

      // 找到父节点
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }

      if (stack.length === 0) {
        root.push(node)
      } else {
        stack[stack.length - 1].node.children.push(node)
      }

      stack.push({ node, level })
    })

    return root
  }

  // 渲染大纲
  const renderOutline = () => {
    // 直接从 DOM 获取编辑器元素
    const editorElement = document.getElementById('aritcle-md-editor')
    if (!editorElement) {
      setTree([])
      return
    }

    let container: HTMLElement | null = null

    // 尝试从不同模式获取内容容器
    const irElement = editorElement.querySelector('.vditor-ir')
    const svPreview = editorElement.querySelector('.vditor-sv__preview')
    const wysiwygElement = editorElement.querySelector('.vditor-wysiwyg')
    const previewElement = editorElement.querySelector('.vditor-preview')

    if (irElement) {
      container = irElement as HTMLElement
    } else if (svPreview) {
      container = svPreview as HTMLElement
    } else if (wysiwygElement) {
      container = wysiwygElement as HTMLElement
    } else if (previewElement) {
      container = previewElement as HTMLElement
    }

    if (!container) {
      setTree([])
      return
    }

    // 查找所有标题元素
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[]

    if (headings.length === 0) {
      setTree([])
      return
    }

    // 构建标题树
    const newTree = buildHeadingTree(headings)
    setTree(newTree)
  }

  // 监听内容和文件路径变化
  useEffect(() => {
    renderOutline()
  }, [currentArticle, activeFilePath])

  // 监听编辑器输入事件，实时更新大纲
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    const handleInput = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(renderOutline, 300)
    }

    emitter.on('editor-input', handleInput)

    return () => {
      if (timer) clearTimeout(timer)
      emitter.off('editor-input', handleInput)
    }
  }, [])

  // 监听编辑器模式切换和初始化完成
  useEffect(() => {
    const handleEditorReady = () => {
      setTimeout(renderOutline, 100)
    }

    emitter.on('vditor:ready', handleEditorReady)
    emitter.on('editor-mode-changed', handleEditorReady)

    return () => {
      emitter.off('vditor:ready', handleEditorReady)
      emitter.off('editor-mode-changed', handleEditorReady)
    }
  }, [])

  return (
    <div className="w-full h-full overflow-auto p-2">
      {tree.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">暂无标题</div>
      ) : (
        <div>
          {tree.map(node => (
            <OutlineNode key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  )
}
