import { readDir } from "@tauri-apps/plugin-fs";
import { getFilePathOptions, getWorkspacePath } from "./workspace";

// 收集文件夹下的所有 Markdown 文件
export async function collectMarkdownFiles(folderPath: string): Promise<Array<{path: string, name: string}>> {
  const files: Array<{path: string, name: string}> = [];
  
  const processDirectory = async (dirPath: string) => {
    try {
      const workspace = await getWorkspacePath();
      const pathOptions = await getFilePathOptions(dirPath);
      
      let entries;
      if (workspace.isCustom) {
        entries = await readDir(pathOptions.path);
      } else {
        entries = await readDir(pathOptions.path, { baseDir: pathOptions.baseDir });
      }
      
      for (const entry of entries) {
        const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
        
        // 过滤隐藏文件夹
        if (entry.name.startsWith('.')) {
          continue;
        }
        
        if (entry.isDirectory) {
          // 递归处理子目录
          await processDirectory(entryPath);
        } else if (entry.name.endsWith('.md')) {
          // 添加 Markdown 文件
          files.push({
            path: entryPath,
            name: entry.name
          });
        }
      }
    } catch (error) {
      console.error(`读取目录 ${dirPath} 失败:`, error);
    }
  };
  
  await processDirectory(folderPath);
  return files;
}