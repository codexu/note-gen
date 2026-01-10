'use client'
import useArticleStore from '@/stores/article'
import { useEffect, useState, useRef } from 'react'
import Vditor from 'vditor'
import { exists, mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import "vditor/dist/index.css"
import CustomToolbar from './custom-toolbar'
import './style.css'
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
import { useAiCompletion } from '@/hooks/useAiCompletion'
import { AiCompletionPreview } from './ai-completion-preview'
import { isMobileDevice } from '@/lib/check'
import { Loader2, Download } from 'lucide-react'
import { infographicRenderer, renderInfographicElements } from '@/lib/infographic'

export function MdEditor() {
  const [editor, setEditor] = useState<Vditor>();
  const { currentArticle, saveCurrentArticle, loading, isPulling, activeFilePath, matchPosition, setMatchPosition, setActiveFilePath, loadFileTree, setCurrentArticle } = useArticleStore()
  const { assetsPath, contentTextScale } = useSettingStore()
  const { fetchMarks } = useMarkStore()
  const [floatBarPosition, setFloatBarPosition] = useState<{left: number, top: number} | null>(null)
  const [selectedText, setSelectedText] = useState<string>('')
  const { theme } = useTheme()
  const { currentLocale } = useI18n()
  const t = useTranslations('article.file.sync')
  // 移动端强制使用即时渲染模式
  const defaultMode = isMobileDevice() ? 'ir' : 'ir'
  const [localMode, setLocalMode] = useLocalStorage<'ir' | 'sv' | 'wysiwyg'>('useLocalMode', defaultMode)
  const [autoCompletionEnabled] = useLocalStorage<boolean>('auto-completion-enabled', true)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const isCreatingFileRef = useRef(false)
  const activeFilePathRef = useRef(activeFilePath)
  const skipClearStackRef = useRef(false) // 标记是否跳过清空撤销栈
  const completionTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [editorElement, setEditorElement] = useState<HTMLElement | null>(null)
  const completionRef = useRef<string>('') // 用 ref 存储最新的 completion 值
  const editorRef = useRef<Vditor | undefined>(undefined) // 用 ref 存储最新的 editor 实例
  const justAcceptedCompletionRef = useRef(false) // 标记是否刚刚接受了补全
  const autoCompletionEnabledRef = useRef(autoCompletionEnabled !== undefined ? autoCompletionEnabled : true) // 用 ref 存储最新的开关状态
  
  // 同步 autoCompletionEnabled 到 ref
  useEffect(() => {
    const newValue = autoCompletionEnabled !== undefined ? autoCompletionEnabled : true
    autoCompletionEnabledRef.current = newValue
  }, [autoCompletionEnabled])

  // 监听开关组件的状态变化事件
  useEffect(() => {
    const handleEnabledChange = (enabled: unknown) => {
      const newValue = enabled !== undefined ? (enabled as boolean) : true
      autoCompletionEnabledRef.current = newValue
    }

    emitter.on('auto-completion-enabled-changed', handleEnabledChange)
    return () => {
      emitter.off('auto-completion-enabled-changed', handleEnabledChange)
    }
  }, [])
  
  // AI 内联补全
  const { completion, isLoading: isCompletionLoading, generateCompletion, acceptCompletion, cancelCompletion } = useAiCompletion({
    onAccept: (completionText) => {
      const currentEditor = editorRef.current
      if (currentEditor) {
        // 设置标志，表示刚刚接受了补全
        justAcceptedCompletionRef.current = true
        
        // 立即清除防抖定时器，防止触发新的补全
        if (completionTimerRef.current) {
          clearTimeout(completionTimerRef.current)
          completionTimerRef.current = null
        }
        
        // 再次确保去除前后空格
        const cleanText = completionText.trim()
        currentEditor.insertValue(cleanText)
        
        // 500ms 后清除标志
        setTimeout(() => {
          justAcceptedCompletionRef.current = false
        }, 500)
      }
    },
  })

  // 同步 AI 补全加载状态到 emitter
  useEffect(() => {
    emitter.emit('ai-completion-loading', isCompletionLoading)
  }, [isCompletionLoading])

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
    const toolbarConfig = createToolbarConfig()

    const vditor = new Vditor('aritcle-md-editor', {
      lang: getLang(),
      height: '100%',
      icon: 'material',
      cdn: '',
      tab: '\t',
      theme: theme === 'dark' ? 'dark' : 'classic',
      toolbar: toolbarConfig,
      typewriterMode,
      customWysiwygToolbar: () => {
        // Custom toolbar handling
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
      customRenders: [infographicRenderer],
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
        editorRef.current = vditor;
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
        
        // 保存编辑器元素引用
        const editorElement = vditor.vditor.element
        setEditorElement(editorElement)
        
        // 监听键盘事件
        const handleKeyDown = (e: KeyboardEvent) => {
          // 方向键：隐藏浮动工具栏和取消补全，然后重新生成
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            resetSelectedText()
            const hadCompletion = !!completionRef.current
            cancelCompletion()
            
            // 如果之前有补全，在光标移动后重新生成
            if (hadCompletion) {
              setTimeout(() => {
                // 检查是否启用了自动补全
                if (!autoCompletionEnabledRef.current) {
                  return
                }
                
                const content = vditor.getValue()
                const cursorPos = content.length
                if (content.trim().length > 20) {
                  generateCompletion(content, cursorPos)
                }
              }, 100)
            }
          }
          
          // 剪切、删除操作：隐藏浮动工具栏
          if (['x', 'X'].includes(e.key) && (e.ctrlKey || e.metaKey)) {
            // Ctrl/Cmd + X 剪切
            resetSelectedText()
          }
          
          if (['Delete', 'Backspace'].includes(e.key)) {
            // 删除键
            resetSelectedText()
          }
          
          // Tab 键：接受补全
          if (e.key === 'Tab') {
            const currentCompletion = completionRef.current
            if (currentCompletion) {
              e.preventDefault()
              acceptCompletion()
            }
          }
          
          // Escape 键：取消补全
          if (e.key === 'Escape') {
            const currentCompletion = completionRef.current
            if (currentCompletion) {
              e.preventDefault()
              cancelCompletion()
            }
          }
          
          // Ctrl/Cmd + Space：手动触发补全
          if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            
            // 检查是否启用了自动补全
            if (!autoCompletionEnabledRef.current) {
              return
            }
            
            const content = vditor.getValue()
            // 使用内容长度作为光标位置（假设光标在末尾）
            const cursorPos = content.length
            generateCompletion(content, cursorPos)
          }
        }
        editorElement?.addEventListener('keydown', handleKeyDown)
        
        // 监听鼠标点击事件，点击时取消补全
        const handleClick = () => {
          const currentCompletion = completionRef.current
          if (currentCompletion) {
            cancelCompletion()
          }
        }
        editorElement?.addEventListener('click', handleClick)
        
        // 监听失焦事件，隐藏浮动工具栏
        const handleBlur = (e: FocusEvent) => {
          // 检查失焦是否不是因为点击了浮动工具栏本身
          const floatBarElement = document.querySelector('[data-float-bar="true"]')
          if (floatBarElement && floatBarElement.contains(e.relatedTarget as Node)) {
            return // 如果焦点移动到浮动工具栏，不隐藏
          }
          resetSelectedText()
        }
        editorElement?.addEventListener('blur', handleBlur, true)
        
        // 监听 beforeinput 事件，在输入前就清除补全预览
        const handleBeforeInput = () => {
          const previews = document.querySelectorAll('.ai-completion-preview, [data-ai-preview="true"]')
          if (previews.length > 0) {
            previews.forEach(preview => preview.remove())
            cancelCompletion()
          }
        }
        editorElement?.addEventListener('beforeinput', handleBeforeInput)
        
        // 清理事件监听
        return () => {
          editorElement?.removeEventListener('keydown', handleKeyDown)
          editorElement?.removeEventListener('click', handleClick)
          editorElement?.removeEventListener('blur', handleBlur, true)
          editorElement?.removeEventListener('beforeinput', handleBeforeInput)
        }
      },
      input: async (value) => {
        // 立即清除所有补全预览 DOM 节点，防止被保留
        const previews = document.querySelectorAll('.ai-completion-preview')
        if (previews.length > 0) {
          previews.forEach(preview => preview.remove())
        }
        
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
          
          // 输入时取消当前补全
          cancelCompletion()
          
          // 防抖触发 AI 补全（停止输入 1.5 秒后）
          if (completionTimerRef.current) {
            clearTimeout(completionTimerRef.current)
          }
          completionTimerRef.current = setTimeout(() => {
            // 如果刚刚接受了补全，不触发新的补全
            if (justAcceptedCompletionRef.current) {
              return
            }
            
            // 检查是否启用了自动补全
            if (!autoCompletionEnabledRef.current) {
              return
            }
            
            // 获取真实的光标位置（使用 DOM Selection API）
            let cursorPos = value.length // 默认使用文档末尾
            try {
              const sel = window.getSelection()
              if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0)
                // 创建一个从文档开始到光标位置的范围
                const preCaretRange = range.cloneRange()
                const editArea = vditor.vditor.element.querySelector('.vditor-ir__marker, .vditor-wysiwyg, .vditor-sv__marker')
                if (editArea) {
                  preCaretRange.selectNodeContents(editArea)
                  preCaretRange.setEnd(range.endContainer, range.endOffset)
                  cursorPos = preCaretRange.toString().length
                }
              }
            } catch {
              // Error getting cursor position, use default
            }
            
            // 只在内容足够长时才触发
            if (value.trim().length > 20) {
              generateCompletion(value, cursorPos)
            }
          }, 200) // 减少延时到 200ms，提高响应速度
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
            // 保存到当前笔记所在文件夹的静态资源目录
            const workspace = await getWorkspacePath()
            
            // 从持久化存储获取最新的 assetsPath 设置
            const currentAssetsPath = await store.get<string>('assetsPath') || assetsPath || 'assets'
            
            // 使用 ref 中的最新 activeFilePath
            const currentActiveFilePath = activeFilePathRef.current
            if (!currentActiveFilePath) {
              return '请先打开一个笔记文件'
            }
            
            const articlePath = currentActiveFilePath.split('/').slice(0, -1).join('/')
            const appDataDirPath = await appDataDir()
            
            for (let i = 0; i < files.length; i++) {
              const uint8Array = new Uint8Array(await files[i].arrayBuffer())
              const fileName = `${uuid()}.${files[i].name.split('.')[files[i].name.split('.').length - 1]}`
              let imagesDir = ''
              if (!workspace.isCustom) {
                imagesDir = `${appDataDirPath}/article/${articlePath}/${currentAssetsPath}`
              } else {
                imagesDir = `${workspace.path}/${articlePath}/${currentAssetsPath}`
              }
              if (!await exists(imagesDir)) {
                await mkdir(imagesDir, { recursive: true })
              }
              const path = `${imagesDir}/${fileName}`
              await writeFile(path, uint8Array)
              
              // 直接插入转换后的 asset:// URL，避免浏览器尝试加载相对路径导致控制台报错
              if (typeof vditor.insertValue === 'function') {
                const assetUrl = convertFileSrc(path)
                vditor.insertValue(`![${files[i].name}](${assetUrl})`)
                
                // 同时缓存这个 URL，避免 handleLocalImage 重复处理
                imageUrlCache.current.set(`/${currentAssetsPath}/${fileName}`, assetUrl)
              }
            }
            
            // 刷新文件树以显示新创建的静态资源文件夹
            await loadFileTree()
            
            return `图片已保存到: ${articlePath}/${currentAssetsPath}/`
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

  // 缓存已转换的图片 URL，避免重复转换导致闪烁
  const imageUrlCache = useRef<Map<string, string>>(new Map())

  // 处理本地相对路径图片
  async function handleLocalImage(vditor: Vditor) {
    const workspace = await getWorkspacePath()
    const previews = [vditor.vditor.ir?.element, vditor.vditor.sv?.element, vditor.vditor.wysiwyg?.element]
    
    for (const element of previews) {
      if (!element) continue
      
      const images = element.querySelectorAll('img')
      for (const img of images) {
        let src = img.getAttribute('src')
        if (!src) continue
        
        // 如果已经是转换后的 URL，跳过
        if (src.startsWith('http') || src.startsWith('asset://')) continue
        
        // 检查缓存
        if (imageUrlCache.current.has(src)) {
          const cachedUrl = imageUrlCache.current.get(src)!
          if (img.getAttribute('src') !== cachedUrl) {
            img.setAttribute('src', cachedUrl)
          }
          continue
        }
        
        // 转换路径
        const articlePath = activeFilePath.split('/').slice(0, -1).join('/')
        if (src.startsWith('./')) {
          src = src.slice(2)
        }
        if (!src.startsWith('/')) {
          src = `/${src}`
        }
        
        let tauriSrc: string
        if (!workspace.isCustom) {
          const relativePath = `/${workspace.path}/${articlePath}${src}`
          tauriSrc = await convertImage(relativePath)
        } else {
          const relativePath = `${workspace.path}/${articlePath}${src}`
          tauriSrc = convertFileSrc(relativePath)
        }
        
        // 缓存转换后的 URL
        const originalSrc = img.getAttribute('src')
        if (originalSrc) {
          imageUrlCache.current.set(originalSrc, tauriSrc)
        }
        
        // 只在 URL 不同时才设置，避免不必要的重绘
        if (img.getAttribute('src') !== tauriSrc) {
          img.setAttribute('src', tauriSrc)
        }
      }
    }
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
      editor.setValue(content, false)
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
      renderInfographicElements(editor.vditor.element, {
        themeMode: editorTheme === 'dark' ? 'dark' : 'light',
      })
    }
  }

  // 同步更新 activeFilePathRef
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  // 同步更新 completionRef
  useEffect(() => {
    completionRef.current = completion
  }, [completion])

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
      if (loading || isPulling) {
        editor.disabled()
      } else {
        editor.enable()
      }
    }
  }, [loading, isPulling, editor])

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
      // 只在非外部更新时清空撤销栈
      if (!skipClearStackRef.current) {
        editor?.clearStack()
      } else {
        skipClearStackRef.current = false // 重置标志
      }
      if (!editor) return
      handleLocalImage(editor)
    }
  }, [currentArticle, editor, activeFilePath])

  // 监听外部内容更新事件（如 agent 工具修改）
  useEffect(() => {
    const handleExternalUpdate = (content: unknown) => {
      if (editor && activeFilePath && typeof content === 'string') {
        const currentContent = editor.getValue()
        
        // 只有内容真的变化了才更新
        if (currentContent !== content) {
          // 使用 setValue(content, false) 保留撤销历史
          // 这会将新内容作为一个编辑操作添加到撤销栈
          // 用户可以通过 Ctrl+Z 撤销回到修改前的状态
          editor.setValue(content, false)
          // 设置标志，告诉 useEffect 不要清空撤销栈
          skipClearStackRef.current = true
          // 更新 store 状态（这会触发 useEffect，但因为标志位，不会清空撤销栈）
          useArticleStore.setState({ currentArticle: content })
          handleLocalImage(editor)
        }
      }
    }

    emitter.on('external-content-update', handleExternalUpdate)
    
    return () => {
      emitter.off('external-content-update', handleExternalUpdate)
    }
  }, [editor, activeFilePath])

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
    className={`flex-1 relative w-full h-full flex flex-col overflow-hidden transition-all ${isDraggingOver ? 'bg-accent/20' : ''}`}
  >
    {/* 拉取加载状态覆盖层 */}
    {isPulling && (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="relative">
            <Loader2 className="size-8 animate-spin" />
            <Download className="size-4 absolute inset-0 m-auto" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">{t('syncingRemote')}</p>
            <p className="text-xs mt-1">{t('pullingRemote')}</p>
          </div>
        </div>
      </div>
    )}
    
    <CustomToolbar editor={editor} />
    <div 
      id="aritcle-md-editor" 
      className="flex-1 min-h-0 overflow-hidden relative"
      style={{minWidth: 0}}
    >
      {/* AI 内联补全预览 */}
      <AiCompletionPreview 
        completion={completion} 
        isLoading={isCompletionLoading} 
        editorElement={editorElement} 
      />
    </div>
    <CustomFooter editor={editor} />
    <FloatBar left={floatBarPosition?.left} top={floatBarPosition?.top} value={selectedText} editor={editor} />
  </div>
}
