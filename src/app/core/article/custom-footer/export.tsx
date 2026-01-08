"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import Vditor from "vditor";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

type ExportFormat = "HTML" | "JSON" | "Markdown" | "PDF";

export default function ExportFormatSelector({editor, disabled}: {editor?: Vditor, disabled?: boolean}) {

    const getFileNameFromContent = (content: string): string => {
        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (titleMatch && titleMatch[1]) {
            return titleMatch[1].trim().substring(0, 50); // 限制长度
        }

        // 如果没有标题，使用内容的前20个字符(排除特殊字符)
        const firstLine = content.split('\n')[0] || '';
        const sanitized = firstLine.replace(/[\\/:*?"<>|]/g, '').trim();
        return sanitized.substring(0, 10) || 'untitled';
    };

  const handleFormatSelect = async (format: ExportFormat) => {
    // PDF 导出使用不同的逻辑
    if (format === "PDF") {
      await handlePDFExport();
      return;
    }

    let content = ''
    switch (format) {
      case "HTML":
        content = editor?.getHTML() || ''
        break;
      case "JSON":
        content = editor?.exportJSON(editor?.getValue() || '') || ''
        break;
      case "Markdown":
        content = editor?.getValue() || ''
        break;
    }

    // 获取文件名
    const markdownContent = editor?.getValue() || '';
    const fileName = getFileNameFromContent(markdownContent);

    // 保存到文件
    let ext = 'md'
    switch (format) {
      case "HTML":
        ext = 'html'
        break;
      case "JSON":
        ext = 'json'
        break;
      case "Markdown":
        ext = 'md'
        break;
    }
    const selected = await save({
      defaultPath: `${fileName}.${ext}`,
      filters: [
        {
          name: format,
          extensions: [ext],
        },
      ],
    })
    if (selected) {
      await writeTextFile(selected, content)
    }
  };

  const handlePDFExport = async () => {
    try {
      const htmlContent = editor?.getHTML() || '';
      const markdownContent = editor?.getValue() || '';
      const fileName = getFileNameFromContent(markdownContent);

      // 打开保存对话框
      const selected = await save({
        defaultPath: `${fileName}.pdf`,
        filters: [
          {
            name: 'PDF',
            extensions: ['pdf'],
          },
        ],
      });

      if (!selected) return;

      // 创建一个隐藏的容器来渲染 HTML
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '794px'; // A4 宽度 (210mm 转 px 为 72dpi)
      container.style.padding = '40px';
      container.style.backgroundColor = 'white';
      container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
      container.style.fontSize = '14px';
      container.style.lineHeight = '1.6';
      container.style.color = '#333';
      
      // 添加 markdown 样式
      container.className = 'markdown-body';
      container.innerHTML = htmlContent;
      
      document.body.appendChild(container);

      // 等待图片加载
      await new Promise(resolve => setTimeout(resolve, 500));

      // 使用 html2canvas 将 HTML 转为图片
      const canvas = await html2canvas(container, {
        scale: 2, // 提高分辨率
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      // 移除临时容器
      document.body.removeChild(container);

      // 创建 PDF
      const imgWidth = 210; // A4 宽度 mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      
      // 如果内容超过一页，需要分页
      const pageHeight = 297; // A4 高度 mm
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // 将 PDF 转为 ArrayBuffer
      const pdfArrayBuffer = pdf.output('arraybuffer');
      
      // 使用 Tauri 保存文件
      await writeFile(selected, new Uint8Array(pdfArrayBuffer));

    } catch (error) {
      console.error('PDF 导出失败:', error);
    }
  };

  return (
    <div className="items-center gap-1 hidden md:flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost"
            size="icon" 
            className="outline-none"
            disabled={disabled}
          >
            <SquareArrowOutUpRightIcon className="size-3!" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          side="top" 
          align="start"
          className="min-w-24"
        >
          <DropdownMenuItem onClick={() => handleFormatSelect("Markdown")}>
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleFormatSelect("HTML")}>
            HTML
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleFormatSelect("JSON")}>
            JSON
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleFormatSelect("PDF")}>
            PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}