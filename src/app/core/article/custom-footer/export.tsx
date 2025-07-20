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
      defaultPath: `123.${ext}`,
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