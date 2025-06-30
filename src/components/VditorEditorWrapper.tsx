import React, { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import "vditor/dist/index.css";
import useArticleStore from '@/stores/article';
import useSettingStore from '@/stores/setting';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useI18n } from '@/hooks/useI18n';
import { useLocalStorage } from 'react-use';
import { isMobileDevice } from '@/lib/check';
import emitter from '@/lib/emitter';
import { appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { v4 as uuid } from 'uuid';
import { convertImage } from '@/lib/utils';
import { getWorkspacePath } from '@/lib/workspace';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import { uploadImage } from '@/lib/imageHosting';
import { toast } from '@/hooks/use-toast';

interface VditorEditorWrapperProps {
  content: string;
  onChange: (newContent: string) => void;
}

export const VditorEditorWrapper: React.FC<VditorEditorWrapperProps> = ({ content, onChange }) => {
  const vditorRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Vditor>();
  const { activeFilePath, matchPosition, setMatchPosition } = useArticleStore();
  const { assetsPath } = useSettingStore();
  const { theme } = useTheme();
  const t = useTranslations('article.editor');
  const { currentLocale } = useI18n();
  const [localMode, setLocalMode] = useLocalStorage<'ir' | 'sv' | 'wysiwyg'>('useLocalMode', 'ir');

  function getLang() {
    switch (currentLocale) {
      case 'en':
        return 'en_US';
      case 'zh':
        return 'zh_CN';
      default:
        return 'zh_CN';
    }
  }

  async function handleLocalImage(vditor: Vditor) {
    const workspace = await getWorkspacePath();
    const previews = [vditor.vditor.ir?.element, vditor.vditor.sv?.element, vditor.vditor.wysiwyg?.element];
    previews.forEach(element => {
      element?.querySelectorAll('img').forEach(async (img) => {
        let src = img.getAttribute('src');
        if (!src) return;
        if (!src.startsWith('http') && !src.startsWith('asset://')) {
          const articlePath = activeFilePath.split('/').slice(0, -1).join('/');
          if (src.startsWith('./')) {
            src = src.slice(2);
          }
          if (!src.startsWith('/')) {
            src = `/${src}`;
          }
          if (!workspace.isCustom) {
            const relativePath = `/${workspace.path}/${articlePath}${src}`;
            const tauriSrc = await convertImage(relativePath);
            img.setAttribute('src', tauriSrc);
          } else {
            const relativePath = `${workspace.path}/${articlePath}${src}`;
            const tauriSrc = convertFileSrc(relativePath);
            img.setAttribute('src', tauriSrc);
          }
        }
      });
    });
  }

  async function uploadImages(files: File[]) {
    const list = await Promise.all(
      files.map((file) => {
        return new Promise<string>(async (resolve, reject) => {
          if (!file.type.includes('image')) return;
          const toastNotification = toast({
            title: t('upload.uploading'),
            description: file.name,
            duration: 600000,
          });
          await uploadImage(file).then(async url => {
            resolve(url);
          }).catch(err => {
            reject(err);
          }).finally(() => {
            toastNotification.dismiss();
          });
        });
      })
    );
    return list;
  }

  const setEditorContent = (newContent: string) => {
    if (!editor) return;
    editor.setValue(newContent);
    editor.renderPreview(newContent);

    if (matchPosition !== null) {
      setTimeout(() => {
        try {
          let editorElement: HTMLElement | null = null;
          const vditorInstance = editor as any;
          if (vditorInstance.vditor) {
            if (localMode === 'ir' && vditorInstance.vditor.ir) {
              editorElement = vditorInstance.vditor.ir.element;
            } else if (localMode === 'wysiwyg' && vditorInstance.vditor.wysiwyg) {
              editorElement = vditorInstance.vditor.wysiwyg.element;
            } else if (localMode === 'sv' && vditorInstance.vditor.sv) {
              editorElement = vditorInstance.vditor.sv.element;
            }
          }

          if (editorElement) {
            const textBefore = newContent.substring(0, matchPosition);
            const lineCount = (textBefore.match(/\n/g) || []).length;
            const range = document.createRange();
            const textNodes = Array.from(editorElement.querySelectorAll('*'))
              .filter(node => node.childNodes.length > 0 && 
                     node.childNodes[0].nodeType === Node.TEXT_NODE);
            
            let currentPos = 0;
            let targetNode = null;
            let targetOffset = 0;
            
            for (const node of textNodes) {
              const textContent = node.textContent || '';
              if (currentPos + textContent.length >= matchPosition) {
                targetNode = node.childNodes[0];
                targetOffset = matchPosition - currentPos;
                break;
              }
              currentPos += textContent.length;
            }
            
            if (targetNode) {
              try {
                range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent?.length || 0));
                range.setEnd(targetNode, Math.min(targetOffset + 1, targetNode.textContent?.length || 0));
                
                const selection = window.getSelection();
                if (selection) {
                  selection.removeAllRanges();
                  selection.addRange(range);
                  
                  const targetElement = range.startContainer.parentElement;
                  if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }
              } catch (e) {
                console.error('Error when setting range:', e);
              }
            } else {
              const lineElements = editorElement.querySelectorAll('div[data-block="0"]');
              if (lineCount < lineElements.length) {
                lineElements[lineCount]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
          }
        } catch (e) {
          console.error('Error scrolling to match position:', e);
        }
        setMatchPosition(null);
      }, 300);
    }
  };

  const setTheme = (newTheme: string) => {
    if (editor) {
      const editorTheme = newTheme === 'dark' ? 'dark' : 'light';
      const contentTheme = newTheme === 'dark' ? 'dark' : 'light';
      const codeTheme = newTheme === 'dark' ? 'github-dark' : 'github-light';
      editor.setTheme(editorTheme === 'dark' ? 'dark' : 'classic', contentTheme, codeTheme);
    }
  };

  useEffect(() => {
    if (vditorRef.current && !editor) {
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
      ];

      if (isMobileDevice()) {
        toolbarConfig = toolbarConfig.slice(0, 12).filter((item) => item !== '|');
      }

      const newVditor = new Vditor(vditorRef.current, {
        lang: getLang(),
        height: document.documentElement.clientHeight - 100,
        icon: 'material',
        cdn: '',
        theme: theme === 'dark' ? 'dark' : 'classic',
        toolbar: toolbarConfig,
        link: {
          isOpen: false,
          click: (dom: Element) => {
            const href = dom.getAttribute('href') || dom.innerHTML;
            if (!href) return;
            window.open(href);
          },
        },
        hint: {
          extend: [
            {
              key: '...',
              hint: async () => {
                emitter.emit('toolbar-continue');
                return [];
              },
            },
            {
              key: '???',
              hint: async () => {
                emitter.emit('toolbar-question');
                return [];
              },
            },
          ],
        },
        after: () => {
          setEditor(newVditor);
          const editModeButtons = newVditor.vditor.element.querySelectorAll('.edit-mode-button .vditor-hint button');
          editModeButtons.forEach(button => {
            button.addEventListener('click', () => {
              const mode = button.getAttribute('data-mode');
              if (!mode) return;
              setLocalMode(mode as 'ir' | 'sv' | 'wysiwyg');
            });
          });
          if (activeFilePath === '') {
            newVditor.setValue('', true);
          }
        },
        input: (value) => {
          onChange(value);
          emitter.emit('editor-input');
          handleLocalImage(newVditor);
        },
        mode: localMode,
        upload: {
          async handler(files: File[]) {
            const store = await Store.load('store.json');
            const accessToken = await store.get('githubImageAccessToken');
            const useImageRepo = await store.get('useImageRepo');
            if (accessToken && useImageRepo) {
              const filesUrls = await uploadImages(files);
              if (newVditor) {
                for (let i = 0; i < filesUrls.length; i++) {
                  newVditor.insertValue(`![${files[i].name}](${filesUrls[i]})`);
                }
              }
              return filesUrls.join('\n');
            } else {
              const workspace = await getWorkspacePath();
              const articlePath = activeFilePath.split('/').slice(0, -1).join('/');
              const appDataDirPath = await appDataDir();
              for (let i = 0; i < files.length; i++) {
                const uint8Array = new Uint8Array(await files[i].arrayBuffer());
                const fileName = `${uuid()}.${files[i].name.split('.')[files[i].name.split('.').length - 1]}`;
                let imagesDir = '';
                if (!workspace.isCustom) {
                  imagesDir = `${appDataDirPath}/article/${articlePath}/${assetsPath}`;
                } else {
                  imagesDir = `${workspace.path}/${articlePath}/${assetsPath}`;
                }
                if (!await exists(imagesDir)) {
                  await mkdir(imagesDir);
                }
                const path = `${imagesDir}/${fileName}`;
                await writeFile(path, uint8Array);
                newVditor.insertValue(`![${files[i].name}](/${assetsPath}/${fileName})`);
              }
              return '图片已保存到本地';
            }
          },
        },
        counter: {
          enable: true,
          after: (length: number) => {
            emitter.emit('toolbar-text-number', length);
          },
        },
      });
    }

    return () => {
      if (editor) {
        editor.destroy();
        setEditor(undefined);
      }
    };
  }, [vditorRef, editor, activeFilePath, getLang, localMode, theme, assetsPath, t, setLocalMode, onChange]);

  useEffect(() => {
    if (editor) {
      setEditorContent(content);
      handleLocalImage(editor);
    }
  }, [content, editor, matchPosition, localMode, setMatchPosition]);

  useEffect(() => {
    if (editor) {
      if (useArticleStore.getState().loading) {
        editor.disabled();
      } else {
        editor.enable();
      }
    }
  }, [useArticleStore.getState().loading, editor]);

  useEffect(() => {
    setTheme(theme === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme || 'light');
  }, [theme, editor]);

  useEffect(() => {
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (editor && theme === 'system') {
        const editorTheme = matchMedia.matches ? 'dark' : 'light';
        setTheme(editorTheme);
      }
    };
    matchMedia.addEventListener('change', handler);
    return () => {
      matchMedia.removeEventListener('change', handler);
    };
  }, [theme, editor]);

  useEffect(() => {
    emitter.on('toolbar-copy-html', () => {
      const html = editor?.getHTML();
      navigator.clipboard.writeText(html || '');
      toast({
        title: t('copySuccess'),
        description: `HTML ${t('copySuccessDescription')}`,
      });
    });
    emitter.on('toolbar-copy-markdown', () => {
      const markdown = editor?.getValue();
      navigator.clipboard.writeText(markdown || '');
      toast({
        title: t('copySuccess'),
        description: `Markdown ${t('copySuccessDescription')}`,
      });
    });
    emitter.on('toolbar-copy-json', () => {
      const markdown = editor?.getValue();
      const json = editor?.exportJSON(markdown || '');
      navigator.clipboard.writeText(json || '');
      toast({
        title: t('copySuccess'),
        description: `JSON ${t('copySuccessDescription')}`,
      });
    });
    return () => {
      emitter.off('toolbar-copy-html');
      emitter.off('toolbar-copy-markdown');
      emitter.off('toolbar-copy-json');
    };
  }, [editor, t]);

  return <div ref={vditorRef} id="aritcle-md-editor" className='flex-1'></div>;
};