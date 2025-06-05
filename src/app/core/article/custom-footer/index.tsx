import Vditor from 'vditor'
import Sync from "./sync";
import History from "./history";
import TextNumber from "./text-number";
import PrimarySync from "./primary-sync";
import CopyMarkdown from "./copy-markdown";
import CopyHtml from "./copy-html";
import CopyJson from "./copy-json";

export default function CustomFooter({editor}: {editor?: Vditor}) {
  return <div className="h-6 w-full px-2 border-t shadow-sm items-center flex justify-between overflow-hidden">
    <div className="flex items-center gap-1">
      <TextNumber />
      <CopyMarkdown />
      <CopyHtml />
      <CopyJson />
    </div>
    <div className="flex items-center gap-1">
      <PrimarySync />
      <History editor={editor} />
      <Sync editor={editor} />
    </div>
  </div>
}