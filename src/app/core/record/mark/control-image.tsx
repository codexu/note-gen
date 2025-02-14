import { TooltipButton } from "@/components/tooltip-button"
import { insertMark, Mark } from "@/db/marks"
import { fetchAiDesc } from "@/lib/ai"
import ocr from "@/lib/ocr"
import useMarkStore from "@/stores/mark"
import useTagStore from "@/stores/tag"
import { BaseDirectory, copyFile, exists, mkdir, readFile } from "@tauri-apps/plugin-fs"
import { ImagePlus } from "lucide-react"
import { uploadFile, uint8ArrayToBase64 } from "@/lib/github"
import useSettingStore from "@/stores/setting"
import { v4 as uuid } from 'uuid'
import { RepoNames } from "@/lib/github.types"
import { open } from '@tauri-apps/plugin-dialog';
import { _t } from '@/locales';

export function ControlImage() {

  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { apiKey, githubUsername } = useSettingStore()
  const { fetchMarks, addQueue, setQueue, removeQueue } = useMarkStore()

  async function selectImages() {
    const filePaths = await open({
      multiple: true,
      directory: false,
      filters: [{
        name: 'Image',
        extensions: ['png', 'jpeg', 'jpg', 'gif', 'webp','svg', 'bmp', 'ico']
      }]
    });
    if (!filePaths) return
    filePaths.forEach(async (path) => {
      await uploadImage(path)
    })
  }

  async function uploadImage(path: string) {
    const queueId = uuid()
    addQueue({ queueId, progress: _t('cache_image'), type: 'image', startTime: Date.now() })
    const ext = path.substring(path.lastIndexOf('.') + 1)
    const isImageFolderExists = await exists('image', { baseDir: BaseDirectory.AppData})
    if (!isImageFolderExists) {
      await mkdir('image', { baseDir: BaseDirectory.AppData})
    }
    await copyFile(path, `image/${queueId}.${ext}`, { toPathBaseDir: BaseDirectory.AppData})
    const file = await readFile(path)
    const filename = `${queueId}.${ext}`
    setQueue(queueId, { progress: _t('ocr_recognition_progress') });
    const content = await ocr(`image/${filename}`)
    setQueue(queueId, { progress: _t('ai_content_recognition_progress') });
    let desc = ''
    if (apiKey) {
      desc = await fetchAiDesc(content).then(res => res ? res : content) || content
    } else {
      desc = content
    }
    const mark: Partial<Mark> = {
      tagId: currentTagId,
      type: 'image',
      content,
      url: filename,
      desc,
    }
    if (githubUsername) {
      setQueue(queueId, { progress: _t('uploading_to_server') });
      const res = await uploadFile({
        ext,
        file: uint8ArrayToBase64(file),
        filename,
        repo: RepoNames.image
      })
      if (res) {
        setQueue(queueId, { progress: _t('notify_jsdelivr') });
        await fetch(`https://purge.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`)
        mark.url = `https://cdn.jsdelivr.net/gh/${githubUsername}/${RepoNames.image}@main/${res.data.content.name}`
      } else {
        mark.url = filename
      }
    }
    removeQueue(queueId)
    await insertMark(mark)
    await fetchMarks()
    await fetchTags()
    getCurrentTag()
  }

  return (
    <TooltipButton icon={<ImagePlus />} tooltipText={_t('illustration_action')} onClick={selectImages} />
  )
}
