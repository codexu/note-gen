import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus } from "lucide-react"
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from "@tauri-apps/plugin-fs";
import useTagStore from "@/stores/tag";
import useMarkStore from "@/stores/mark";
import { insertMark } from "@/db/marks";

// 常见的代码格式
const codeExtensions = [
  // Web开发
  'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'php', 'mjs', 'mts',
  // 编程语言
  'py', 'java', 'cpp', 'c', 'cs', 'go', 'rb', 'rs', 'swift', 'kt', 'scala', 'dart', 'lua', 'r',
  // 标记/配置
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'graphql', 'sql',
  // Shell脚本
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  // 其他
  'asm', 'pl', 'clj', 'ex', 'elm', 'f90', 'hs', 'jl', 'swift', 'ml'
];
const textFileExtensions = ['txt', 'md', 'csv'];
const fileExtensions: string[] = []

export function ControlFile() {
  const t = useTranslations();
  const { currentTagId, fetchTags, getCurrentTag } = useTagStore()
  const { fetchMarks } = useMarkStore()

  async function selectFile() {
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [{
        name: 'files',
        extensions: [...textFileExtensions, ...fileExtensions, ...codeExtensions]
      }]
    });
    if (!filePath) return
    await readFileByPath(filePath)
  }

  async function readFileByPath(path: string) {
    const ext = path.substring(path.lastIndexOf('.') + 1)
    if ([...textFileExtensions, ...codeExtensions].includes(ext)) {
      const content = await readTextFile(path)
      const resetText = content.replace(/'/g, '')
      await insertMark({ tagId: currentTagId, type: 'file', desc: resetText, content: resetText })
      await fetchMarks()
      await fetchTags()
      getCurrentTag()
    }
  }

  return (
    <TooltipButton icon={<FilePlus />} tooltipText={t('record.mark.type.file')} onClick={selectFile} />
  )
}