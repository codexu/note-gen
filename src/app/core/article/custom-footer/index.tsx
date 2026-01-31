import Vditor from 'vditor'
import Sync from "./sync";
import HistoryComponent from "./history";
import TextNumber from "./text-number";
import PrimarySync from "./primary-sync";
import Copy from "./copy";
import Export from "./export";
import VectorCalc from "./vector-calc";
import AutoCompletionToggle from "./auto-completion-toggle";
import PullButton from "./pull";
import useArticleStore from "@/stores/article";

export default function CustomFooter({editor}: {editor?: Vditor}) {
  const { activeFilePath } = useArticleStore()
  return <div className="h-6 w-full px-2 border-t shadow-sm items-center flex justify-between overflow-hidden">
    <div className="flex items-center gap-1">
      {activeFilePath && <TextNumber />}
      <AutoCompletionToggle />
      <Copy editor={editor} disabled={!activeFilePath} />
      <Export editor={editor} disabled={!activeFilePath} />
    </div>
    <div className="flex items-center gap-1">
      <VectorCalc />
      <PrimarySync />
      <HistoryComponent editor={editor} disabled={!activeFilePath} />
      <PullButton />
      <Sync editor={editor} disabled={!activeFilePath} />
    </div>
  </div>
}