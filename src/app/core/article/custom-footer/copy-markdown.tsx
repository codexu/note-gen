import { Button } from "@/components/ui/button";
import emitter from "@/lib/emitter";

export default function CopyMarkdown() {

  return <div className="items-center gap-1 hidden lg:flex">
    <Button 
      variant="ghost" 
      size="sm" 
      className="outline-none"
      onClick={() => emitter.emit('toolbar-copy-markdown')}
    >
      <span className="text-xs">Markdown</span>
    </Button>
  </div>
}