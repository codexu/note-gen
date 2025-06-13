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
import { fileToBase64, uploadFile } from '@/lib/github'
import { RepoNames } from '@/lib/github.types'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useI18n } from '@/hooks/useI18n'
import emitter from '@/lib/emitter'
import dayjs from 'dayjs'
import { appDataDir } from '@tauri-apps/api/path'
import { v4 as uuid } from 'uuid'
import { convertImage } from '@/lib/utils'
import CustomFooter from './custom-footer'
import { useLocalStorage } from 'react-use'
import { open } from '@tauri-apps/plugin-shell'
import { isMobileDevice } from '@/lib/check'

export function MdEditor() {
  const [editor, setEditor] = useState<Vditor>();
  const { currentArticle, saveCurrentArticle, loading, activeFilePath, matchPosition, setMatchPosition } = useArticleStore()
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

  function init() {
    let toolbarConfig = [
      { name: 'undo', tipPosition: 's' },
      { name: 'redo', tipPosition: 's' },
      '|',{
        name: 'mark',
        tipPosition: 's',
        tip: t('toolbar.mark.tooltip'),
        className: 'right',
        icon: '<svg><use xlink:href="#vditor-icon-mark"></svg>',
        click: () => emitter.emit('toolbar-mark'),
      },
      {
        name: 'question',
        tipPosition: 's',
        tip: t('toolbar.question.tooltip'),
        className: 'right',
        icon: '<svg><use xlink:href="#vditor-icon-question"></svg>',
        click: () => emitter.emit('toolbar-question'),
      },
      {
        name: 'continue',
        tipPosition: 's',
        tip: t('toolbar.continue.tooltip'),
        className: 'right',
        icon: '<svg><use xlink:href="#vditor-icon-list-plus"></svg>',
        click: () => emitter.emit('toolbar-continue'),
      },
      {
        name: 'polish',
        tipPosition: 's',
        tip: t('toolbar.polish.tooltip'),
        className: 'right',
        icon: '<svg><use xlink:href="#vditor-icon-polish"></svg>',
        click: () => emitter.emit('toolbar-polish')
      },
      {
        name: 'translation',
        tipPosition: 's',
        tip: t('toolbar.translation.tooltip'),
        className: 'right',
        icon: '<svg><use xlink:href="#vditor-icon-translation"></svg>',
        click: () => emitter.emit('toolbar-translation'),
      },
      '|',
      { name: 'headings', tipPosition: 's', className: 'bottom' },
      { name: 'bold', tipPosition: 's' },
      { name: 'italic', tipPosition: 's' },
      { name: 'strike', tipPosition: 's' },
      '|',
      { name: 'line', tipPosition: 's' },
      { name: 'quote', tipPosition: 's' },
      { name: 'list', tipPosition: 's' },
      { name: 'ordered-list', tipPosition: 's' },
      { name: 'check', tipPosition: 's' },
      { name: 'code', tipPosition: 's' },
      { name: 'inline-code', tipPosition: 's' },
      { name: 'upload', tipPosition: 's' },
      { name: 'link', tipPosition: 's' },
      { name: 'table', tipPosition: 's' },
      '|',
      { name: 'edit-mode', tipPosition: 's', className: 'bottom edit-mode-button' },
      { name: 'preview', tipPosition: 's' },
      { name: 'outline', tipPosition: 's' },
    ]

    if (isMobileDevice()) {
      toolbarConfig = toolbarConfig.slice(0, 12).filter((item) => item !== '|')
    }
    
    const vditor = new Vditor('aritcle-md-editor', {
      lang: getLang(),
      height: document.documentElement.clientHeight - 100,
      icon: 'material',
      cdn: '',
      theme: theme === 'dark' ? 'dark' : 'classic',
      toolbar: toolbarConfig,
      link: {
        isOpen: false,
        click: (dom: Element) => {
          const href = dom.getAttribute('href') || dom.innerHTML
          if (!href) return
          open(href)
        }
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
        
      },
      input: (value) => {
        saveCurrentArticle(value)
        emitter.emit('editor-input')
      },
      mode: localMode,
      upload: {
        async handler(files: File[]) {
          const store = await Store.load('store.json');
          const accessToken = await store.get('accessToken')
          const useImageRepo = await store.get('useImageRepo')
          if (accessToken && useImageRepo) {
            const filesUrls = await uploadImages(files)
            if (vditor) {
              for (let i = 0; i < filesUrls.length; i++) {
                vditor.insertValue(`![${files[i].name}](${filesUrls[i]})`)
              }
            }
            return filesUrls.join('\n')
          } else {
            // 保存到本地 images/ 目录下
            const appDataDirPath = await appDataDir()
            const imagesDir = `${appDataDirPath}/image`
            if (!await exists(imagesDir)) {
              await mkdir(imagesDir)
            }
            for (let i = 0; i < files.length; i++) {
              const uint8Array = new Uint8Array(await files[i].arrayBuffer())
              const fileName = `${uuid()}.${files[i].name.split('.')[files[i].name.split('.').length - 1]}`
              const path = `${imagesDir}/${fileName}`
              await writeFile(path, uint8Array)
              const imageSrc = await convertImage(`/image/${fileName}`)
              vditor.insertValue(`![${files[i].name}](${imageSrc})`)
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
          const path = dayjs().format('YYYY-MM')
          const fileBase64 = await fileToBase64(file)
          const ext = file.name.split('.')[file.name.split('.').length - 1]
          await uploadFile({
            ext,
            file: fileBase64,
            repo: RepoNames.image,
            path
          }).then(async res => {
            const store = await Store.load('store.json');
            const jsdelivr = await store.get('jsdelivr')
            let url = res?.data.content.download_url
            if (jsdelivr) {
              const githubUsername = await store.get('githubUsername')
              await fetch(`https://purge.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${path}/${res?.data.content.name}`)
              url = `https://cdn.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${path}/${res?.data.content.name}`
            }
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
    editor.setValue(content)
    
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
    emitter.on('toolbar-copy-html', () => {
      const html = editor?.getHTML()
      navigator.clipboard.writeText(html || '')
      toast({
        title: t('copySuccess'),
        description: `HTML ${t('copySuccessDescription')}`,
      })
    })
    emitter.on('toolbar-copy-markdown', () => {
      const markdown = editor?.getValue()
      navigator.clipboard.writeText(markdown || '')
      toast({
        title: t('copySuccess'),
        description: `Markdown ${t('copySuccessDescription')}`,
      })
    })  
    emitter.on('toolbar-copy-json', () => {
      const markdown = editor?.getValue()
      const json = editor?.exportJSON(markdown || '')
      navigator.clipboard.writeText(json || '')
      toast({
        title: t('copySuccess'),
        description: `JSON ${t('copySuccessDescription')}`,
      })
    })
    return () => {
      emitter.off('toolbar-copy-html')
      emitter.off('toolbar-copy-markdown')
      emitter.off('toolbar-copy-json')
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
  }, [currentArticle])

  return <div className='flex-1 w-full h-full lg:h-screen flex flex-col overflow-hidden dark:bg-zinc-950'>
    <CustomToolbar editor={editor} />
    <div id="aritcle-md-editor" className='flex-1'></div>
    <CustomFooter editor={editor} />
  </div>
}