import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import useClipboardStore from "@/stores/clipboard";
import { toast } from "@/hooks/use-toast";
import { BaseDirectory, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileSymlink } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { getPasteTargetDirectory } from "./paste-target";

interface PasteInFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function PasteInFolder({ item, shortcut }: PasteInFolderProps) {
  const t = useTranslations('article.file');
  const { clipboardItem, clipboardOperation, setClipboardItem } = useClipboardStore();
  const { loadFileTree } = useArticleStore();
  const path = computedParentPath(item);

  async function handlePasteInFolder() {
    if (!clipboardItem) {
      toast({ title: t('clipboard.empty'), variant: 'destructive' });
      return;
    }

    try {
      const { generateCopyFilename, generateCopyFoldername } = await import('@/lib/default-filename')
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()

      // 粘贴目标：当前文件夹
      const targetDir = getPasteTargetDirectory(path)

      // 生成唯一的目标名称（文件或文件夹）
      const targetName = clipboardItem.isDirectory
        ? await generateCopyFoldername(targetDir, clipboardItem.name)
        : await generateCopyFilename(targetDir, clipboardItem.name)

      const targetPathRelative = targetDir ? `${targetDir}/${targetName}` : targetName
      const targetPathOptions = await getFilePathOptions(targetPathRelative)
      const sourcePathOptions = await getFilePathOptions(clipboardItem.path)

      if (clipboardItem.isDirectory) {
        // 创建目标文件夹
        if (workspace.isCustom) {
          await mkdir(targetPathOptions.path)
        } else {
          await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
        }

        // 递归复制文件夹内容
        const copyDirRecursively = async (srcRelative: string, destRelative: string) => {
          const entries = await readDir(
            srcRelative,
            workspace.isCustom ? {} : { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData }
          )

          for (const entry of entries) {
            const srcEntryPath = `${srcRelative}/${entry.name}`
            const destEntryPath = `${destRelative}/${entry.name}`

            if (entry.isDirectory) {
              // 创建子目录
              if (workspace.isCustom) {
                await mkdir(destEntryPath)
              } else {
                await mkdir(destEntryPath, { baseDir: targetPathOptions.baseDir })
              }
              await copyDirRecursively(srcEntryPath, destEntryPath)
            } else {
              // 复制文件
              try {
                let content = ''
                if (workspace.isCustom) {
                  content = await readTextFile(srcEntryPath)
                  await writeTextFile(destEntryPath, content)
                } else {
                  content = await readTextFile(srcEntryPath, { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData })
                  await writeTextFile(destEntryPath, content, { baseDir: targetPathOptions.baseDir })
                }
              } catch (err) {
                console.error(`Error copying file ${srcEntryPath}:`, err)
              }
            }
          }
        }

        await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)
      } else {
        // 文件复制
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(sourcePathOptions.path)
          await writeTextFile(targetPathOptions.path, content)
        } else {
          content = await readTextFile(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          await writeTextFile(targetPathOptions.path, content, { baseDir: targetPathOptions.baseDir })
        }
      }

      // 如果是剪切操作，删除原文件
      if (clipboardOperation === 'cut') {
        if (workspace.isCustom) {
          await remove(sourcePathOptions.path, { recursive: true })
        } else {
          await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
        }
        // 清空剪贴板
        setClipboardItem(null, 'none')
      }

      // 刷新文件树
      loadFileTree()
      toast({ title: t('clipboard.pasted') })
    } catch (error) {
      console.error('Paste operation failed:', error)
      toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' })
    }
  }

  return (
    <ContextMenuItem
      inset
      disabled={!clipboardItem}
      onClick={handlePasteInFolder}
      menuType="file"
    >
      <FileSymlink className="mr-2 h-4 w-4" />
      {t('context.paste')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
