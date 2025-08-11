'use client'
import useArticleStore from '@/stores/article'
import { useEffect, useState } from 'react'
import Vditor from 'vditor'
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
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
import { set } from 'lodash-es'

export function MdEditor() {
  const [editor, setEditor] = useState<Vditor>();
  const { currentArticle, saveCurrentArticle, loading, activeFilePath, matchPosition, setMatchPosition } = useArticleStore()
  const { assetsPath } = useSettingStore()
  const [floatBarPosition, setFloatBarPosition] = useState<{left: number, top: number} | null>(null)
  const [selectedText, setSelectedText] = useState<string>('')
  const { theme } = useTheme()
  const t = useTranslations('article.editor')
  const { currentLocale } = useI18n()
  const [localMode, setLocalMode] = useLocalStorage<'ir' | 'sv' | 'wysiwyg'>('useLocalMode', 'ir')

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
    const toolbarConfig = createToolbarConfig(t)

    const vditor = new Vditor('aritcle-md-editor', {
      lang: getLang(),
      height: document.documentElement.clientHeight - 100,
      icon: 'material',
      cdn: '',
      theme: theme === 'dark' ? 'dark' : 'classic',
      toolbar: toolbarConfig,
      typewriterMode,
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
      input: (value) => {
        saveCurrentArticle(value)
        emitter.emit('editor-input')
        handleLocalImage(vditor)
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

  useEffect(() => {
    emitter.on('toolbar-reset-selected-text', resetSelectedText)
    return () => {
      emitter.off('toolbar-reset-selected-text')
    }
  }, [editor])

  useEffect(() => {
    if (!activeFilePath) {
      editor?.destroy()
      setEditor(undefined)
    } else {
      if (!editor) {
        init()
        setContent(currentArticle)
      }
    }
  }, [activeFilePath])

  useEffect(() => {
    if (activeFilePath) {
      init()
    }
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
    setContent(currentArticle)
    editor?.clearStack()
    if (!editor) return
    handleLocalImage(editor)
  }, [currentArticle, editor])

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

  return <div className='flex-1 relative w-full h-full lg:h-screen flex flex-col overflow-hidden dark:bg-zinc-950'>
    <CustomToolbar editor={editor} />
    <div id="aritcle-md-editor" className='flex-1'></div>
    <CustomFooter editor={editor} />
    <FloatBar left={floatBarPosition?.left} top={floatBarPosition?.top} value={selectedText} editor={editor} />
  </div>
}