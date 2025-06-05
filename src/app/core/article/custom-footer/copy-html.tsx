import { Button } from "@/components/ui/button";
import emitter from "@/lib/emitter";

export default function CopyHtml() {

  return <div className="flex items-center gap-1">
    <Button 
      variant="ghost" 
      size="sm" 
      className="outline-none"
      onClick={() => emitter.emit('toolbar-copy-html')}
    >
      <span className="text-xs">HTML</span>
    </Button>
  </div>
}