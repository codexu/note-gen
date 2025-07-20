import { toast } from "@/hooks/use-toast";
import type Vditor from 'vditor';

// 导出PDF函数 from md-editor.tsx
export function exportToPdf(
  editor: Vditor | undefined,
  activeFilePath: string, 
  isEmpty: boolean,
  t: (key: string) => string // 添加翻译函数参数
) {
  if (!editor) {
    toast({
      title: t('exportPDFeditorNotReady'),
      variant: "destructive"
    });
    return;
  }
  
  if (!activeFilePath) {
    toast({
      title: t('exportPDFnoFileSelected'),
      description: t('exportPDFselectFileFirst'),
      variant: "destructive"
    });
    return;
  }
  if (isEmpty) {
    toast({
      title: t('exportPDFfileIsEmpty'),
      description: t('exportPDFinputFileFirst'),
      variant: "destructive"
    });
    return;
  }
  try {
    // 获取编辑器内容
    const content = editor?.getHTML();
    // 显示导出提示
    toast({
      title: t('exportPDFexporting'),
      description: t('exportPDFinstructions'),
      duration: 3000
    });

    // 添加笔记打印布局
    const ContentContainer = document.createElement('div');
    ContentContainer.id = 'content-container';
    ContentContainer.style.position = 'absolute';
    ContentContainer.style.left = '-9999px';
    document.body.appendChild(ContentContainer);
  
    // 提取文件名（不含扩展名）
    const fileName = activeFilePath?.split('/').pop()?.replace(/\.[^/.]+$/, "") ?? 'Untitled';
    document.title = fileName;
  
    // 创建打印内容
    ContentContainer.innerHTML = `
      <div id="only-content">  
        <div id="editorContent">${content || ''}</div>
      </div> 
    `;

    // 动态添加打印样式
    const ContentStyle = document.createElement('style');
    ContentStyle.textContent = `
      @media print {
        /* === 修复根元素高度限制问题 === */
        html, body {
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* 隐藏不需要打印的元素 */
        body > *:not(#content-container) {
          display: none !important;
        }
  
        /* 打印容器样式 */
        #content-container {
          position: static;
          display: block ! important;
          left: 0 !important;
          width: 100% !important;
          padding: 0;
          margin: 0;
        }

        /* 页面布局 */
        @page {
          /* 隐藏浏览器默认的页眉页脚 */
          margin-top: 15mm; 
          margin-bottom: 15mm; 
          margin-left: 15mm;
          margin-right: 15mm;
          size: A4; /*297mm*210mm*/

          @top-center {
          content: "${fileName}";
          font-family: "Noto Sans SC", sans-serif;
          font-size: 8pt;
          color: #666;
          }

          @bottom-center {
          content: counter(page) " / " counter(pages); /* 居中显示页码 */
          font-family: "Noto Sans SC", sans-serif;
          font-size: 8pt;
          color: #666;
          }
        }  

        /* 主内容容器 */
        #only-content {
          position: relative;
          width: 100%;
          top: 0;
          padding-top: 0;
          padding-bottom: 0;
          box-sizing: border-box;
          page-break-inside: avoid;
        }   
        /* 内容区域 */
        #editorContent {
          top: 0;
          font-family: "Noto Serif SC", "Noto Serif CJK SC", "Noto Serif JP", "Noto Serif CJK JP", "Times New Roman", "华文宋体", "宋体", serif;
          font-size: 12pt;
          /*letter-spacing: 0.1em;*/
          line-height: 1.5;
          color: #000;
          height: 267mm !important;
          text-indent: 2em;  
          /* 分页支持 */
          page-break-inside: always;
        }  
        /* 分页控制 */
        .page-break {
          page-break-before: always;
        }

        /* 代码样式(包括代码块和行内代码等) */
        code {
          padding: 0.15em 0.4em;
          background: #dddbdbff;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          border-radius: 4px;
          font-family: "Noto Sans SC", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans CJK JP", "Consolas", "Courier New", "Microsoft YaHei", sans-serif !important;
          font-size: 1em; 
          vertical-align: baseline; /* 基线对齐 */
        }
        pre code {
          padding: 0em  !important;
          background: none !important;
          border-radius: 0px  !important;
          font-family: "Noto Sans SC", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans CJK JP", "Consolas", "Courier New", "Microsoft YaHei", sans-serif !important;
          font-size: 10pt !important; 
          vertical-align: baseline; /* 基线对齐 */
        }
        /* 优化代码块打印 */
        pre {
          font-family: "Noto Sans SC", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans CJK JP", "Consolas", "Courier New", "Microsoft YaHei", sans-serif !important;
          font-size: 10pt !important;
          line-height: 1.2 !important;
          orphans: 3 !important;
          white-space: pre-wrap !important;
          word-break: break-word !important;
          background-color: #f5f5f5 !important;
          border: 1px solid #ddd !important;
          padding: 15px !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          border-radius: 5px !important;
          margin-top: 8pt !important;
          margin-bottom: 8pt !important;
          text-indent: 0 !important;
          page-break-inside: avoid !important;
        }  
        /* 代码块标题 */
        pre::before {
          content: " ";
          display: block;
          background: #555;
          color: white;
          padding: 5px 10px;
          font-size: 0.9em;
          margin: -15px -15px 15px -15px;
          border-radius: 4px 4px 0 0;
          text-indent: 0 !important;
        }

        /* 链接显示URL */
        a::after {
          content: " (" attr(href) ")";
          font-size: 90%;
          color: #666;
        }

        /* 同时应用于无序列表(ul)和有序列表(ol)的基础样式 */
        /* 恢复默认列表样式 */
        ul, ol {
          margin: 1em 0; /* 恢复默认的垂直间距 */
          padding-left: 40px; /* 默认的左侧缩进 */
          text-indent: 0; /* 移除文本缩进 */
        }
        ul {
          list-style-type: disc; /* 一级无序列表使用实心圆点 */
        }
        ul ul {
          list-style-type: circle; /* 二级无序列表使用空心圆点 */
        }
        ul ul ul {
          list-style-type: square; /* 三级无序列表使用方块 */
        }
        ol {
          list-style-type: decimal; /* 有序列表使用十进制数字 */
        }
        li {
          position: static; /* 恢复默认定位 */
          padding-left: 0; /* 移除自定义左侧内边距 */
          margin-bottom: 0.5em; /* 适当的列表项间距 */
        }
        li::before {
          content: none; /* 移除自定义伪元素 */
        }

        /* 优化表格打印 */
        table {
          width: 100% !important;
          border-collapse: collapse !important;  
          margin-top: 8pt !important;
          margin-bottom: 8pt !important;
          font-size: 10pt !important;
          text-indent: 0 !important;
          page-break-inside: avoid !important;
        }  
        th, td {
          border: 1px solid #ddd !important;
          padding: 8px !important;
          /* 水平居中 */
          text-align: center !important;        
          /* 垂直居中 */
          vertical-align: middle !important;
          border: 1px solid #ddd !important;
        }

        /* 引用样式 */
        blockquote {
            background: #f5f5f5;
            border: 1px solid #ddd1;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;          
            margin: 8pt 0;
            border-radius: 4px;
            text-indent: 0 !important;
            font-family: "Noto Serif SC", "Noto Serif CJK SC", "Noto Serif JP", "Noto Serif CJK JP", "Constantia", "华文宋体", "宋体", serif !important;
            font-size: 1.05em; /* 比正文大5% */
            padding: 1em 2rem;
            position: relative;
        }      
        blockquote::after {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 5px;
            height: 100%;
            background: #555;
        }

        /*分割线*/
        hr {
          margin: 1em 0;              /* 上下边距 */
        }
  
        /* 标题样式 */
        h1, h2, h3, h4, h5, h6 {
          font-family: "Noto Sans SC", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans CJK JP", "Arial", "Meiryo", "Microsoft YaHei", sans-serif !important;
          page-break-before: auto;
          page-break-after: avoid;
        }  
        h1 {         
          font-size: 22pt !important;
          font-weight: bold !important;
          text-align: center !important;
          line-height: 1.5 !important;
          margin-top: 80mm !important;
          margin-left: 15mm !important;
          margin-right: 15mm !important;
          margin-bottom: 1.5em !important;
          text-indent: 0 !important;
          page-break-before: always !important;
          page-break-after: avoid !important;
        }
        h2 { 
          font-size: 18pt !important;
          font-weight: bold !important;
          text-align: center !important;
          line-height: 1.5 !important;
          margin-top: 1em !important;
          margin-bottom: 1em !important;
          text-indent: 0 !important;
          page-break-before: always !important;
          page-break-after: avoid !important;
        }
        h3 { 
          font-size: 16pt !important;
          font-weight: bold !important;
          text-align: center !important;
          line-height: 1.5 !important;
          margin-top: 1em !important;
          margin-bottom: 0.5em !important;        
          text-indent: 0 !important;
          page-break-before: auto !important;
          page-break-after: avoid !important;
        }
        h4 { 
          font-size: 15pt !important;
          // font-weight: bold !important;
          line-height: 1.5 !important;
          margin-top: 0.8em !important;
          margin-bottom: 0.4em !important;
          text-indent: 0em !important;
          page-break-before: auto !important;
          page-break-after: avoid !important;
        }
        h5 { 
          font-size: 14pt !important;
          // font-weight: bold !important;
          line-height: 1.5 !important;
          margin-top: 0.6em !important;
          margin-bottom: 0.3em !important;
          text-indent: 2em !important;
          page-break-before: auto !important;
          page-break-after: avoid !important;
        }
        h6 { 
          font-size: 12pt !important;
          // font-weight: bold !important;
          line-height: 1.5 !important;
          margin-top: 0.4em !important;
          margin-bottom: 0.2em !important;
          text-indent: 2em !important;
          page-break-before: auto !important;
          page-break-after: avoid !important;
        }
  
        /* 图片优化 */
        img {
          max-width: 100% !important;
          max-height: 100% !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          margin-top: 8pt !important;
          margin-bottom: 8pt !important;
          margin-left: auto !important;
          margin-right: auto !important;
          page-break-inside: avoid;
        }   
      }
    `;
    document.head.appendChild(ContentStyle);

    // 延迟确保内容已渲染
    setTimeout(() => {
      // 触发打印
      window.print();
  
      // 清理打印布局
      setTimeout(() => {
        const container = document.getElementById('content-container');
        if (container) {
          document.body.removeChild(container);
          document.head.removeChild(ContentStyle);
        }
      }, 1000);
    }, 500);
  
  } catch (error) {
    console.error('导出PDF失败:', error);
    toast({
      title: t('exportPDFfailed'),
      description: t('exportPDFerrorMessage'),
      variant: "destructive"
    });
  }
}