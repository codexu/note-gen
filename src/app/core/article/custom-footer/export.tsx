"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import Vditor from "vditor";

type ExportFormat = "HTML" | "JSON" | "Markdown";

export default function ExportFormatSelector({editor}: {editor?: Vditor}) {

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

  return (
    <div className="items-center gap-1 hidden lg:flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost"
            size="icon" 
            className="outline-none"
          >
            <SquareArrowOutUpRightIcon className="!size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          side="top" 
          align="start"
          className="min-w-[6rem]"
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}