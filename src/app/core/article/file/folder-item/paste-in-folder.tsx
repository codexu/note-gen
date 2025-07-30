import { ContextMenuItem } from "@/components/ui/context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import useClipboardStore from "@/stores/clipboard";
import { toast } from "@/hooks/use-toast";
import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { ask } from '@tauri-apps/plugin-dialog';

interface PasteInFolderProps {
  item: DirTree;
}

export function PasteInFolder({ item }: PasteInFolderProps) {
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
      const sourcePath = `article/${clipboardItem.path}`;
      const targetPath = `article/${path}/${clipboardItem.name}`;
      
      // Check if target already exists
      const targetExists = await exists(targetPath, { baseDir: BaseDirectory.AppData });
      
      if (targetExists) {
        const confirmOverwrite = await ask(t('clipboard.confirmOverwrite'), {
          title: 'NoteGen',
          kind: 'warning',
        });
        if (!confirmOverwrite) return;
      }

      if (clipboardItem.isDirectory) {
        // For directories, need to copy recursively
        // Create target directory
        await mkdir(targetPath, { baseDir: BaseDirectory.AppData });
        
        // Copy recursively using readDir, readTextFile, and writeTextFile
        const copyDirRecursively = async (src: string, dest: string) => {
          const entries = await readDir(src, { baseDir: BaseDirectory.AppData });
          
          for (const entry of entries) {
            const srcPath = `${src}/${entry.name}`;
            const destPath = `${dest}/${entry.name}`;
            
            if (entry.isDirectory) {
              // It's a directory
              await mkdir(destPath, { baseDir: BaseDirectory.AppData });
              await copyDirRecursively(srcPath, destPath);
            } else {
              // It's a file
              try {
                const content = await readTextFile(srcPath, { baseDir: BaseDirectory.AppData });
                await writeTextFile(destPath, content, { baseDir: BaseDirectory.AppData });
              } catch (err) {
                console.error(`Error copying file ${srcPath}:`, err);
              }
            }
          }
        };
        
        await copyDirRecursively(sourcePath, targetPath);
      } else {
        // For files, just copy the file
        try {
          const content = await readTextFile(sourcePath, { baseDir: BaseDirectory.AppData });
          await writeTextFile(targetPath, content, { baseDir: BaseDirectory.AppData });
        } catch (err) {
          console.error(`Error copying file ${sourcePath}:`, err);
          throw err;
        }
      }
      
      // If cut operation, delete the original
      if (clipboardOperation === 'cut') {
        await remove(sourcePath, { baseDir: BaseDirectory.AppData });
        // Clear clipboard after cut & paste operation
        setClipboardItem(null, 'none');
      }

      // Refresh file tree
      loadFileTree();
      toast({ title: t('clipboard.pasted') });
    } catch (error) {
      console.error('Paste operation failed:', error);
      toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' });
    }
  }

  return (
    <ContextMenuItem 
      inset 
      disabled={!clipboardItem} 
      onClick={handlePasteInFolder}
    >
      {t('context.paste')}
    </ContextMenuItem>
  );
}
