import { TooltipButton } from "@/components/tooltip-button";
import { toast } from "@/hooks/use-toast";
import { fetchAi } from "@/lib/ai";
import { decodeBase64ToString, getFileCommits, getFiles, uint8ArrayToBase64, uploadFile } from "@/lib/github";
import { RepoNames } from "@/lib/github.types";
import useArticleStore from "@/stores/article";
import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { CloudUpload, LoaderCircle } from "lucide-react";
import { ExposeParam } from "md-editor-rt";
import { RefObject, useState } from "react";
import { diffWordsWithSpace } from 'diff';
import useSettingStore from "@/stores/setting";
import { _t } from '@/locales/index';

export default function Sync({mdRef}: {mdRef: RefObject<ExposeParam>}) {
  const { activeFilePath, currentArticle } = useArticleStore()
  const { accessToken } = useSettingStore()
  const [loading, setLoading] = useState(false)
  async function handleSync() {
    setLoading(true)
    mdRef.current?.focus()
    // 获取上一次提交的记录内容
    let message = _t('upload_file_commit_message', activeFilePath)
    const commits = await getFileCommits({ path: activeFilePath, repo: RepoNames.sync })
    if (commits?.length > 0) {
      const lastCommit = commits[0]
      const latContent = await getFiles({path: `${activeFilePath}?ref=${lastCommit.sha}`, repo: RepoNames.sync})
      const diff = diffWordsWithSpace(decodeBase64ToString(latContent?.content || ''), currentArticle)
      const addDiff = diff.filter(item => item.added).map(item => item.value).join('')
      const removeDiff = diff.filter(item => item.removed).map(item => item.value).join('')
      const text = _t('ai_diff_request', addDiff, removeDiff)
      message = await fetchAi(text)
    }
    const res = await getFiles({path: activeFilePath, repo: RepoNames.sync})
    let sha = undefined
    if (res) {
      sha = res.sha
    }
    const filename = activeFilePath?.split('/').pop()
    const _path = activeFilePath?.split('/').slice(0, -1).join('/')
    const file = await readFile(`article/${activeFilePath}`, { baseDir: BaseDirectory.AppData  })
    const uploadRes = await uploadFile({
      ext: 'md',
      file: uint8ArrayToBase64(file),
      filename: `${_path && _path + '/'}${filename}`,
      sha,
      message,
      repo: RepoNames.sync
    })
    if (uploadRes?.status === 200 || uploadRes?.status === 201) {
      if (uploadRes.data.content?.sha === sha) {
        toast({title: _t('no_changes_to_commit'), variant: 'destructive'})
      } else {
        toast({title: _t('sync_successful'), description: uploadRes.data?.commit.message})
      }
    }
    setLoading(false)
  }
  return (
    <TooltipButton
      icon={loading ? <LoaderCircle className="animate-spin size-4" /> : <CloudUpload />}
      tooltipText={_t('sync')}
      onClick={handleSync}
      disabled={!accessToken}
    >
    </TooltipButton>
  )
}
