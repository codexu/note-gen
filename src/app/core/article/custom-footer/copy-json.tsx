import { Button } from "@/components/ui/button";
import emitter from "@/lib/emitter";

export default function CopyJson() {

  return <div className="flex items-center gap-1">
    <Button 
      variant="ghost" 
      size="sm" 
      className="outline-none"
      onClick={() => emitter.emit('toolbar-copy-json')}
    >
      <span className="text-xs">JSON</span>
    </Button>
  </div>
}