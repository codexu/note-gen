'use client'
import useSettingStore from "@/stores/setting";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes'
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/github.min.css';
import './chat.css';

type ThemeType = 'light' | 'dark' | 'system';

type ChatPreviewProps = {
  text: string;
  streaming?: boolean; // 是否为流式内容
};

export default function ChatPreview({text, streaming = false}: ChatPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme()
  const [mdTheme, setMdTheme] = useState<ThemeType>('light')
  const { codeTheme, contentTextScale } = useSettingStore()
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [displayedText, setDisplayedText] = useState<string>('');
  const animationRef = useRef<number | null>(null);
  const lastTextRef = useRef<string>('');

  const md = useRef<MarkdownIt | null>(null);

  useEffect(() => {
    hljs.registerLanguage('javascript', javascript);
    hljs.registerLanguage('typescript', typescript);
    hljs.registerLanguage('bash', bash);
    hljs.registerLanguage('json', json);
    hljs.registerLanguage('html', xml);
    hljs.registerLanguage('css', css);
  }, []);
  
  useEffect(() => {
    md.current = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function (str, lang): string {
        if (lang && hljs.getLanguage(lang)) {
          try {
            const themeClass = mdTheme === 'dark' ? 'hljs-dark' : 'hljs-light';
            return `<pre class="hljs ${themeClass}"><code>` +
              hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>';
          } catch {}
        }
        // 使用通用高亮
        const themeClass = mdTheme === 'dark' ? 'hljs-dark' : 'hljs-light';
        return `<pre class="hljs ${themeClass}"><code>` +
          (md.current ? md.current.utils.escapeHtml(str) : str) +
          '</code></pre>';
      }
    });

    md.current.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return self.renderToken(tokens, idx, options);
    }
  }, [mdTheme]);

  // 打字机效果动画
  const animateTypewriter = useCallback((targetText: string) => {
    // 如果动画正在进行中，先取消
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startText = displayedText;
    const startTime = performance.now();
    const duration = 80; // 80ms 内平滑显示新内容

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // 使用 easeOutQuad 使动画更平滑
      const easeProgress = 1 - (1 - progress) * (1 - progress);

      const newLength = Math.floor(startText.length + (targetText.length - startText.length) * easeProgress);

      if (newLength > displayedText.length && newLength <= targetText.length) {
        const newText = targetText.slice(0, newLength);
        if (md.current) {
          setHtmlContent(md.current.render(newText));
        }
        setDisplayedText(newText);
      }

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayedText(targetText);
        if (md.current) {
          setHtmlContent(md.current.render(targetText));
        }
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [displayedText]);

  // 处理流式内容更新
  useEffect(() => {
    if (!streaming) {
      // 非流式内容，直接显示
      if (text && md.current) {
        setHtmlContent(md.current.render(text));
        setDisplayedText(text);
      } else if (!text) {
        setHtmlContent('');
        setDisplayedText('');
      }
      return;
    }

    // 流式内容
    const newText = text;

    // 检测是否是首次加载或文本被重置
    if (!lastTextRef.current || newText.length < lastTextRef.current.length) {
      // 重置或首次加载
      setDisplayedText(newText);
      if (md.current) {
        setHtmlContent(md.current.render(newText));
      }
      lastTextRef.current = newText;
      return;
    }

    // 有新内容到达
    const addedContent = newText.slice(displayedText.length);

    // 如果添加的内容不多，使用打字机效果
    if (addedContent.length > 0 && addedContent.length <= 50) {
      animateTypewriter(newText);
    } else {
      // 添加内容太多，直接显示
      setDisplayedText(newText);
      if (md.current) {
        setHtmlContent(md.current.render(newText));
      }
    }

    lastTextRef.current = newText;
  }, [text, streaming, animateTypewriter]);

  // 清理动画
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (theme === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setMdTheme('dark')
      } else {
        setMdTheme('light')
      }
    } else {
      setMdTheme(theme as ThemeType)
    }
  }, [theme])

  useEffect(() => {
    // 加载Markdown主题样式
    const link = document.createElement('link');
    link.id = 'markdown-theme-style';
    link.rel = 'stylesheet';
    switch (theme) {
      case 'dark':
        link.href = '/markdown/github-markdown-dark.css';
        break;
      case 'light':
        link.href = '/markdown/github-markdown-light.css';
        break;
      case 'system':
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          link.href = '/markdown/github-markdown-dark.css';
        } else {
          link.href = '/markdown/github-markdown-light.css';
        }
        break;
    }
    
    const existingLink = document.getElementById('markdown-theme-style');
    if (existingLink) document.head.removeChild(existingLink);
    document.head.appendChild(link);

    // 监听系统主题变化
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        const themeValue = matchMedia.matches ? 'dark' : 'light'
        setMdTheme(themeValue)
      }
    }
    matchMedia.addEventListener('change', handler)
    return () => {
      matchMedia.removeEventListener('change', handler)
    }
  }, [theme])
  
  // 应用正文文字大小缩放
  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.style.fontSize = `${contentTextScale + 15}%`
    }
  }, [contentTextScale])

  // 根据主题选择样式
  const getThemeClass = () => {
    if (mdTheme === 'dark') {
      return 'markdown-body markdown-dark';
    }
    return 'markdown-body';
  };

  // 应用高亮样式
  const getHighlightStyle = () => {
    return codeTheme || 'github';
  };

  // 检测是否为 macOS
  const isMacOS = () => {
    if (typeof window === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  };

  // 处理文本选中后的拖拽（仅 macOS）
  const handleDragStart = (e: React.DragEvent) => {
    // 非 macOS 系统直接阻止拖拽
    if (!isMacOS()) {
      e.preventDefault();
      return;
    }

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()

    if (selectedText) {
      // 设置拖拽数据为选中的文本
      e.dataTransfer.setData('text/plain', selectedText)
      e.dataTransfer.effectAllowed = 'copy'

      // 创建自定义拖拽预览图像，只显示选中的文本
      const dragPreview = document.createElement('div')
      dragPreview.style.position = 'absolute'
      dragPreview.style.left = '-9999px'
      dragPreview.style.padding = '8px 12px'
      dragPreview.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'
      dragPreview.style.color = 'white'
      dragPreview.style.borderRadius = '4px'
      dragPreview.style.fontSize = '14px'
      dragPreview.style.maxWidth = '300px'
      dragPreview.style.overflowWrap = 'break-word'
      dragPreview.textContent = selectedText.length > 50 ? selectedText.substring(0, 50) + '...' : selectedText

      document.body.appendChild(dragPreview)
      e.dataTransfer.setDragImage(dragPreview, 0, 0)

      // 拖拽结束后移除预览元素
      setTimeout(() => {
        document.body.removeChild(dragPreview)
      }, 0)
    } else {
      // 如果没有选中文本，阻止拖拽
      e.preventDefault()
    }
  }

  // 没有内容时不渲染
  if (!text || !text.trim()) {
    return null
  }

  return (
    <div className="flex-1 max-w-[calc(100vw-30px)] md:max-w-[calc(100vw-440px)]">
      <div 
        ref={previewRef}
        className={getThemeClass()}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
        data-highlight-style={getHighlightStyle()}
        draggable={isMacOS()}
        onDragStart={handleDragStart}
      />
    </div>
  );
}
