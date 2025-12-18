'use client'
import useArticleStore from '@/stores/article'
import { useEffect, useState, useRef } from 'react'
import Vditor from 'vditor'
import { exists, mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import "vditor/dist/index.css"
import CustomToolbar from './custom-toolbar'
import './style.scss'
import { useTheme } from 'next-themes'
import { toast } from '@/hooks/use-toast'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useI18n } from '@/hooks/useI18n'
import emitter from '@/lib/emitter'
import { appDataDir } from '@tauri-apps/api/path'
import { v4 as uuid } from 'uuid'
import { convertImage } from '@/lib/utils'
import CustomFooter from './custom-footer'
import { useLocalStorage } from 'react-use'
import { open } from '@tauri-apps/plugin-shell'
import { getWorkspacePath } from '@/lib/workspace'
import { convertFileSrc } from "@tauri-apps/api/core";
import useSettingStore from '@/stores/setting'
import { uploadImage } from '@/lib/imageHosting'
import FloatBar from './floatbar'
import { createToolbarConfig } from './toolbar.config'
import { delMark } from '@/db/marks'
import useMarkStore from '@/stores/mark'

export function MdEditor() {
  const [editor, setEditor] = useState<Vditor>();
  const { currentArticle, saveCurrentArticle, loading, activeFilePath, matchPosition, setMatchPosition, setActiveFilePath, loadFileTree, setCurrentArticle } = useArticleStore()
  const { assetsPath, contentTextScale } = useSettingStore()
  const { fetchMarks } = useMarkStore()
  const [floatBarPosition, setFloatBarPosition] = useState<{left: number, top: number} | null>(null)
  const [selectedText, setSelectedText] = useState<string>('')
  const [editorWidth, setEditorWidth] = useState<number>(0)
  const { theme } = useTheme()
  const t = useTranslations('article.editor')
  const { currentLocale } = useI18n()
  const [localMode, setLocalMode] = useLocalStorage<'ir' | 'sv' | 'wysiwyg'>('useLocalMode', 'ir')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const isCreatingFileRef = useRef(false)
  const activeFilePathRef = useRef(activeFilePath)

  function getLang() {
    switch (currentLocale) {
      case 'en':
        return 'en_US'
      case 'zh':
        return 'zh_CN'
      default:
        return 'zh_CN'
    }
  }

  async function init() {
    const store = await Store.load('store.json');
    const typewriterMode = await store.get<boolean>('typewriterMode') || false
    const outlinePosition = await store.get<'left' | 'right'>('outlinePosition') || 'left'
    const enableOutline = await store.get<boolean>('enableOutline') || false
    const enableLineNumber = await store.get<boolean>('enableLineNumber') || false
    const editorElement = document.getElementById('aritcle-md-editor')
    const currentWidth = editorElement?.clientWidth || 0
    const toolbarConfig = createToolbarConfig(t, currentWidth)

    const vditor = new Vditor('aritcle-md-editor', {
      lang: getLang(),
      height: '100%',
      icon: 'material',
      cdn: '',
      tab: '\t',
      theme: theme === 'dark' ? 'dark' : 'classic',
      toolbar: toolbarConfig,
      typewriterMode,
      customWysiwygToolbar: (type: TWYSISYGToolbar, element: HTMLElement) => {
        console.log(type, element)
      },
      outline: {
        enable: enableOutline,
        position: outlinePosition,
      },
      select: (value: string) => {
        setSelectedText(value)
        setFloatBarPosition(vditor.getCursorPosition())
      },
      unSelect: () => {
        resetSelectedText()
      },
      link: {
        isOpen: false,
        click: (dom: Element) => {
          const href = dom.getAttribute('href') || dom.innerHTML
          if (!href) return
          open(href)
        }
      },
      preview: {
        hljs: {
          lineNumber: enableLineNumber,
        },
      },
      hint: {
        extend: [
          {
            key: '...',
            hint: async () => {
              emitter.emit('toolbar-continue');
              return []
            }
          },
          {
            key: '???',
            hint: async () => {
              emitter.emit('toolbar-question');
              return []
            }
          },
        ]
      },
      after: () => {
        setEditor(vditor);
        // 切换记录编辑模式
        const editModeButtons = vditor.vditor.element.querySelectorAll('.edit-mode-button .vditor-hint button')
        editModeButtons.forEach(button => {
          button.addEventListener('click', () => {
            const mode = button.getAttribute('data-mode')
            if (!mode) return
            setLocalMode(mode as 'ir' | 'sv' | 'wysiwyg')
          })
        })
        if (activeFilePath === '') {
          vditor.setValue('', true)
        }
        setEditorPadding(vditor)
      },
      input: async (value) => {
        if (!activeFilePathRef.current && !isCreatingFileRef.current) {
          // 自动创建 untitled.md 文件，并写入当前内容
          isCreatingFileRef.current = true
          await createUntitledFile(value)
          isCreatingFileRef.current = false
          return // 创建文件后会触发 setActiveFilePath，不需要再次保存
        }
        if (activeFilePathRef.current) {
          saveCurrentArticle(value)
          emitter.emit('editor-input')
          handleLocalImage(vditor)
        }
      },
      mode: localMode,
      upload: {
        async handler(files: File[]) {
          const store = await Store.load('store.json');
          const useImageRepo = await store.get('useImageRepo')
          if (useImageRepo) {
            const filesUrls = await uploadImages(files)
            if (vditor && typeof vditor.insertValue === 'function') {
              for (let i = 0; i < filesUrls.length; i++) {
                vditor.insertValue(`![${files[i].name}](${filesUrls[i]})`)
              }
            }
            return filesUrls.join('\n')
          } else {
            // 保存到 activeFilePath/image 目录下
            const workspace = await getWorkspacePath()
            const articlePath = activeFilePath.split('/').slice(0, -1).join('/')
            const appDataDirPath = await appDataDir()
            for (let i = 0; i < files.length; i++) {
              const uint8Array = new Uint8Array(await files[i].arrayBuffer())
              const fileName = `${uuid()}.${files[i].name.split('.')[files[i].name.split('.').length - 1]}`
              let imagesDir = ''
              if (!workspace.isCustom) {
                imagesDir = `${appDataDirPath}/article/${articlePath}/${assetsPath}`
              } else {
                imagesDir = `${workspace.path}/${articlePath}/${assetsPath}`
              }
              if (!await exists(imagesDir)) {
                await mkdir(imagesDir)
              }
              const path = `${imagesDir}/${fileName}`
              await writeFile(path, uint8Array)
              if (typeof vditor.insertValue === 'function') {
                vditor.insertValue(`![${files[i].name}](/${assetsPath}/${fileName})`)
              }
            }
            return '图片已保存到本地'
          }
        }
      },
      counter: {
        enable: true,
        after: (length: number) => {
          emitter.emit('toolbar-text-number', length)
        }
      }
    })
  }

  function resetSelectedText() {
    setSelectedText('')
    setFloatBarPosition(null)
  }

  // 自动创建 untitled.md 文件
  async function createUntitledFile(content: string) {
    try {
      const workspace = await getWorkspacePath()
      
      // 生成唯一的文件名
      let fileName = 'untitled.md'
      let counter = 1
      let filePath = fileName
      
      // 检查文件是否存在，如果存在则添加数字后缀
      while (true) {
        const pathOptions = await import('@/lib/workspace').then(m => m.getFilePathOptions(filePath))
        let fileExists = false
        
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (!fileExists) break
        
        fileName = `untitled-${counter}.md`
        filePath = fileName
        counter++
      }
      
      // 创建文件并写入内容
      const pathOptions = await import('@/lib/workspace').then(m => m.getFilePathOptions(filePath))
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }
      
      // 先更新 store 中的内容，避免后续读取文件时覆盖
      setCurrentArticle(content)
      
      // 设置为当前活动文件
      await setActiveFilePath(filePath)
      await loadFileTree()
      
    } catch (error) {
      console.error('Create untitled file error:', error)
    }
  }

  // 设置编辑器 padding
  async function setEditorPadding(vditor: Vditor) {
    const store = await Store.load('store.json');
    const pageView = await store.get<'immersiveView' | 'panoramaView'>('pageView') || 'immersiveView'
    const resetDom = vditor.vditor.element.querySelectorAll('.vditor-reset')
    if (resetDom && pageView === "panoramaView") {
      resetDom.forEach(dom => {
        (dom as HTMLElement).style.setProperty('padding', '10px', 'important')
      })
    }
  }

  // 处理本地相对路径图片
  async function handleLocalImage(vditor: Vditor) {
    const workspace = await getWorkspacePath()
    const previews = [vditor.vditor.ir?.element, vditor.vditor.sv?.element, vditor.vditor.wysiwyg?.element]
    previews.forEach(element => {
      element?.querySelectorAll('img').forEach(async (img) => {
        let src = img.getAttribute('src')
        if (!src) return
        if (!src.startsWith('http') && !src.startsWith('asset://')) {
          const articlePath = activeFilePath.split('/').slice(0, -1).join('/')
          if (src.startsWith('./')) {
            src = src.slice(2)
          }
          if (!src.startsWith('/')) {
            src = `/${src}`
          }
          if (!workspace.isCustom) {
            const relativePath = `/${workspace.path}/${articlePath}${src}`
            const tauriSrc = await convertImage(relativePath)
            img.setAttribute('src', tauriSrc)
          } else {
            const relativePath = `${workspace.path}/${articlePath}${src}`
            const tauriSrc = convertFileSrc(relativePath)
            img.setAttribute('src', tauriSrc)
          }
        }
      })
    })
  }

  async function uploadImages(files: File[]) {
    const list = await Promise.all(
      files.map((file) => {
        return new Promise<string>(async(resolve, reject) => {
          if (!file.type.includes('image')) return
          const toastNotification = toast({
            title: t('upload.uploading'),
            description: file.name,
            duration: 600000,
          })
          await uploadImage(file).then(async url => {
            resolve(url)
          }).catch(err => {
            reject(err)
          }).finally(() => {
            toastNotification.dismiss()
          })
        });
      })
    );
    return list
  }

  // 设置编辑器内容并滚动到匹配位置
  const setContent = (content: string) => {
    if (!editor) return
    try {
      editor.setValue(content)
      editor.renderPreview(content)
    } catch (error) {
      console.error('Error setting editor content:', error)
    }
    // 如果有匹配位置，滚动到对应位置
    if (matchPosition !== null) {
      setTimeout(() => {
        try {
          // 获取编辑器预览区域
          let editorElement: HTMLElement | null = null
          
          // 安全地访问 vditor 属性
          const vditor = editor as any
          if (vditor.vditor) {
            if (localMode === 'ir' && vditor.vditor.ir) {
              editorElement = vditor.vditor.ir.element
            } else if (localMode === 'wysiwyg' && vditor.vditor.wysiwyg) {
              editorElement = vditor.vditor.wysiwyg.element
            } else if (localMode === 'sv' && vditor.vditor.sv) {
              editorElement = vditor.vditor.sv.element
            }
          }
          
          if (editorElement) {
            // 计算目标位置前的文本
            const textBefore = content.substring(0, matchPosition)
            // 计算行数（通过换行符数量）
            const lineCount = (textBefore.match(/\n/g) || []).length
            
            // 创建一个范围来定位匹配位置
            const range = document.createRange()
            const textNodes = Array.from(editorElement.querySelectorAll('*'))
              .filter(node => node.childNodes.length > 0 && 
                     node.childNodes[0].nodeType === Node.TEXT_NODE)
            
            // 尝试找到匹配位置附近的文本节点
            let currentPos = 0
            let targetNode = null
            let targetOffset = 0
            
            for (const node of textNodes) {
              const textContent = node.textContent || ''
              if (currentPos + textContent.length >= matchPosition) {
                targetNode = node.childNodes[0]  // 获取文本节点
                targetOffset = matchPosition - currentPos
                break
              }
              currentPos += textContent.length
            }
            
            // 如果找到了目标节点，设置选择范围并滚动
            if (targetNode) {
              try {
                range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent?.length || 0))
                range.setEnd(targetNode, Math.min(targetOffset + 1, targetNode.textContent?.length || 0))
                
                const selection = window.getSelection()
                if (selection) {
                  selection.removeAllRanges()
                  selection.addRange(range)
                  
                  // 滚动到选中位置
                  const targetElement = range.startContainer.parentElement
                  if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }
              } catch (e) {
                console.error('Error when setting range:', e)
              }
            } else {
              // 如果无法精确定位，尝试通过行号滚动
              const lineElements = editorElement.querySelectorAll('div[data-block="0"]')
              if (lineCount < lineElements.length) {
                lineElements[lineCount]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }
          }
        } catch (e) {
          console.error('Error scrolling to match position:', e)
        }
        
        // 处理完后重置匹配位置
        setMatchPosition(null)
      }, 300) // 给编辑器一点时间来渲染内容
    }
  }

  function setTheme(theme: string) {
    if (editor) {
      const editorTheme = theme === 'dark' ? 'dark' : 'light'
      const contentTheme = theme === 'dark' ? 'dark' : 'light'
      const codeTheme = theme === 'dark' ? 'github-dark' : 'github-light'
      editor.setTheme(editorTheme === 'dark' ? 'dark' : 'classic', contentTheme, codeTheme)
    }
  }

  // 同步更新 activeFilePathRef
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    emitter.on('toolbar-reset-selected-text', resetSelectedText)
    return () => {
      emitter.off('toolbar-reset-selected-text')
    }
  }, [editor])

  useEffect(() => {
    if (!editor) {
      init()
      if (activeFilePath) {
        setContent(currentArticle)
      }
    } else {
      // 如果文件被删除或取消选中，清空编辑器
      if (!activeFilePath) {
        editor.setValue('', true)
        setCurrentArticle('')
      }
    }
  }, [activeFilePath])

  useEffect(() => {
    if (editor) {
      editor.destroy()
      setEditor(undefined)
    }
    init()
  }, [currentLocale])

  useEffect(() => {
    if (editor) {
      if (loading) {
        editor.disabled()
      } else {
        editor.enable()
      }
    }
  }, [loading])

  useEffect(() => {
    let editorTheme: string | undefined
    if (theme === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        editorTheme = 'dark'
      }
    } else {
      editorTheme = theme
    }
    if (editor) {
      setTheme(editorTheme || 'light')
    }
  }, [theme, editor])

  useEffect(() => {
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (editor && theme === 'system') {
        const editorTheme = matchMedia.matches ? 'dark' : 'light'
        setTheme(editorTheme)
      }
    }
    matchMedia.addEventListener('change', handler)
    return () => {
      matchMedia.removeEventListener('change', handler)
    }
  }, [theme, editor])

  useEffect(() => {
    if (activeFilePath) {
      setContent(currentArticle)
      editor?.clearStack()
      if (!editor) return
      handleLocalImage(editor)
    }
  }, [currentArticle, editor, activeFilePath])

  useEffect(() => {
    window.addEventListener('resize', () => {
      if (!editor) return
      setEditorPadding(editor)
    })
    return () => {
      window.removeEventListener('resize', () => {
        if (!editor) return
        setEditorPadding(editor)
      })
    }
  }, [editor])

  // 监听编辑器宽度变化，动态更新工具栏
  useEffect(() => {
    if (!editor) return

    const editorElement = document.getElementById('aritcle-md-editor')
    if (!editorElement) return

    let resizeTimer: NodeJS.Timeout | null = null
    let lastToolbarLevel = -1

    // 根据宽度计算当前应该显示的工具栏级别
    const getToolbarLevel = (width: number) => {
      if (width >= 868) return 4 // 显示所有组
      if (width >= 489) return 3 // 显示到 group3
      if (width >= 326) return 2 // 显示到 groupLast
      return 1 // 只显示基础组
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width
        
        // 清除之前的定时器
        if (resizeTimer) {
          clearTimeout(resizeTimer)
        }

        // 防抖：等待拖拽结束后再更新
        resizeTimer = setTimeout(() => {
          const currentLevel = getToolbarLevel(width)
          
          // 只在跨越阈值时才更新工具栏
          if (currentLevel !== lastToolbarLevel && lastToolbarLevel !== -1) {
            setEditorWidth(width)
            
            const newToolbarConfig = createToolbarConfig(t, width)
            const toolbarElement = editor.vditor.toolbar?.element
            if (toolbarElement) {
              const store = Store.load('store.json')
              store.then(async (s) => {
                const typewriterMode = await s.get<boolean>('typewriterMode') || false
                const outlinePosition = await s.get<'left' | 'right'>('outlinePosition') || 'left'
                const enableOutline = await s.get<boolean>('enableOutline') || false
                const enableLineNumber = await s.get<boolean>('enableLineNumber') || false
                
                const currentContent = editor.getValue()
                const currentMode = editor.vditor.currentMode
                
                editor.destroy()
                
                const vditor = new Vditor('aritcle-md-editor', {
                  lang: getLang(),
                  height: '100%',
                  icon: 'material',
                  cdn: '',
                  tab: '\t',
                  theme: theme === 'dark' ? 'dark' : 'classic',
                  toolbar: newToolbarConfig,
                  typewriterMode,
                  outline: {
                    enable: enableOutline,
                    position: outlinePosition,
                  },
                  preview: {
                    hljs: {
                      lineNumber: enableLineNumber,
                    },
                  },
                  mode: currentMode,
                  after: () => {
                    vditor.setValue(currentContent, false)
                    setEditor(vditor)
                    setEditorPadding(vditor)
                  },
                  input: (value) => {
                    saveCurrentArticle(value)
                    emitter.emit('editor-input')
                    handleLocalImage(vditor)
                  },
                })
              })
            }
          }
          
          lastToolbarLevel = currentLevel
        }, 300) // 300ms 防抖延迟
      }
    })

    resizeObserver.observe(editorElement)
    
    // 初始化时记录当前级别
    const initialWidth = editorElement.clientWidth
    lastToolbarLevel = getToolbarLevel(initialWidth)

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeObserver.disconnect()
    }
  }, [editor, editorWidth, t, theme, currentLocale])

  // 应用正文文字大小缩放
  useEffect(() => {
    if (editor) {
      const vditorElement = editor.vditor.element
      if (vditorElement) {
        // 应用到 vditor-reset 元素（实际的编辑内容区域）
        const resetElements = vditorElement.querySelectorAll('.vditor-reset') as NodeListOf<HTMLElement>
        resetElements.forEach(element => {
          element.style.fontSize = `${contentTextScale}%`
        })
        
        // 同时应用到预览区域
        const preview = vditorElement.querySelector('.vditor-preview') as HTMLElement
        if (preview) preview.style.fontSize = `${contentTextScale}%`
      }
    }
  }, [contentTextScale, editor])

  // 处理拖放事件
  useEffect(() => {
    if (!editor) return

    const editorContainer = document.getElementById('article-editor')
    if (!editorContainer) return

    const handleDragOver = (e: DragEvent) => {
      // 检查是否是从记录拖拽过来的
      if (e.dataTransfer?.types.includes('text/plain')) {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setIsDraggingOver(true)
        
        // 聚焦编辑器并根据鼠标位置设置光标
        if (editor) {
          editor.focus()
          
          // 尝试根据鼠标位置设置光标
          // Vditor 使用 CodeMirror 或其他编辑器，需要找到对应的编辑区域
          const vditorElement = editor.vditor.element
          const editArea = vditorElement?.querySelector('.vditor-ir__marker, .vditor-wysiwyg, .vditor-sv') as HTMLElement
          
          if (editArea) {
            // 使用 document.caretPositionFromPoint 或 document.caretRangeFromPoint
            let range: Range | null = null
            
            if (document.caretRangeFromPoint) {
              range = document.caretRangeFromPoint(e.clientX, e.clientY)
            } else if ((document as any).caretPositionFromPoint) {
              const position = (document as any).caretPositionFromPoint(e.clientX, e.clientY)
              if (position) {
                range = document.createRange()
                range.setStart(position.offsetNode, position.offset)
              }
            }
            
            if (range) {
              const selection = window.getSelection()
              if (selection) {
                selection.removeAllRanges()
                selection.addRange(range)
              }
            }
          }
        }
      }
    }

    const handleDragLeave = (e: DragEvent) => {
      // 只有当离开整个编辑器容器时才清除状态
      const rect = editorContainer.getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX >= rect.right ||
        e.clientY < rect.top ||
        e.clientY >= rect.bottom
      ) {
        setIsDraggingOver(false)
      }
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDraggingOver(false)

      if (!e.dataTransfer) return

      // 获取拖放的文本内容和记录信息
      const markdownContent = e.dataTransfer.getData('text/plain')
      const markJson = e.dataTransfer.getData('application/json')
      
      if (markdownContent && editor) {
        // 光标位置已经在 dragover 时设置好了，直接插入内容
        // 不添加换行，允许插入到文本中间
        editor.insertValue(markdownContent)
        editor.focus()
        
        // 插入成功后删除记录
        if (markJson) {
          try {
            const mark = JSON.parse(markJson)
            if (mark.id) {
              await delMark(mark.id)
              // 刷新记录列表
              await fetchMarks()
            }
          } catch (error) {
            console.error('Failed to delete mark:', error)
          }
        }
      }
    }

    editorContainer.addEventListener('dragover', handleDragOver)
    editorContainer.addEventListener('dragleave', handleDragLeave)
    editorContainer.addEventListener('drop', handleDrop)

    return () => {
      editorContainer.removeEventListener('dragover', handleDragOver)
      editorContainer.removeEventListener('dragleave', handleDragLeave)
      editorContainer.removeEventListener('drop', handleDrop)
    }
  }, [editor])


  return <div 
    id="article-editor" 
    className={`flex-1 relative w-full h-full flex flex-col overflow-hidden dark:bg-zinc-950 transition-all ${isDraggingOver ? 'bg-accent/20' : ''}`}
  >
    <CustomToolbar editor={editor} />
    <div 
      id="aritcle-md-editor" 
      className="flex-1"
      style={{minWidth: 0}}
    ></div>
    <CustomFooter editor={editor} />
    <FloatBar left={floatBarPosition?.left} top={floatBarPosition?.top} value={selectedText} editor={editor} />
  </div>
}