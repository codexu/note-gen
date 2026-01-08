"use client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyIcon } from "lucide-react";
import Vditor from "vditor";

type CopyFormat = "HTML" | "JSON" | "Markdown";

export default function CopyFormatSelector({editor, disabled}: {editor?: Vditor, disabled?: boolean}) {

  const handleFormatSelect = (format: CopyFormat) => {
    switch (format) {
      case "HTML":
        navigator.clipboard.writeText(editor?.getHTML() || '')
        break;
      case "JSON":
        navigator.clipboard.writeText(editor?.exportJSON(editor?.getValue() || '') || '')
        break;
      case "Markdown":
        navigator.clipboard.writeText(editor?.getValue() || '')
        break;
    }
    toast({ title: `${format}已复制到剪切板` })
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
            <CopyIcon className="size-3!" />
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}