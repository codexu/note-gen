import { readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { join } from "@tauri-apps/api/path";

export interface MarkdownFile {
  name: string;
  path: string;
  relativePath: string;
}

// 文件夹关联接口
export interface LinkedFolder {
  name: string;           // 文件夹名称
  path: string;           // 完整路径
  relativePath: string;   // 相对路径
  fileCount: number;      // 包含的markdown文件数量
  indexedCount: number;   // 已索引的文件数量
}

// 统一的关联资源类型
export type LinkedResource = MarkdownFile | LinkedFolder;

// 类型守卫：判断是否为文件夹
export function isLinkedFolder(resource: LinkedResource): resource is LinkedFolder {
  return 'fileCount' in resource;
}

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

/**
 * 获取工作区中所有Markdown文件（平铺所有文件夹）
 */
export async function getAllMarkdownFiles(): Promise<MarkdownFile[]> {
  const workspace = await getWorkspacePath();

  console.log('[getAllMarkdownFiles] 开始获取文件列表', {
    workspacePath: workspace.path,
    isCustom: workspace.isCustom,
  });

  const files: MarkdownFile[] = [];

  // 递归处理目录的辅助函数
  async function processDirectory(dirPath: string, useCustomPath: boolean, relativePath: string = "", depth: number = 0): Promise<void> {
    let entries: DirEntry[];

    const debugPrefix = '[getAllMarkdownFiles]'.padEnd(depth * 2 + 20, ' ');

    try {
      console.log(`${debugPrefix} 处理目录`, {
        dirPath,
        useCustomPath,
        relativePath: relativePath || '(root)',
        depth,
      });

      if (useCustomPath) {
        entries = await readDir(dirPath);
      } else {
        entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData });
      }

      console.log(`${debugPrefix} 目录读取成功`, {
        entryCount: entries.length,
        entries: entries.map(e => ({ name: e.name, isDir: e.isDirectory })),
      });

      for (const entry of entries) {
        // 跳过隐藏文件和文件夹
        if (entry.name === '.DS_Store' || entry.name.startsWith('.')) {
          console.log(`${debugPrefix} 跳过隐藏项`, { name: entry.name });
          continue;
        }

        const currentRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          // 递归处理子目录
          const childPath = await join(dirPath, entry.name);
          await processDirectory(childPath, useCustomPath, currentRelativePath, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          // 添加Markdown文件
          const fullPath = useCustomPath
            ? await join(dirPath, entry.name)
            : currentRelativePath;

          console.log(`${debugPrefix} 找到 Markdown 文件`, {
            name: entry.name,
            relativePath: currentRelativePath,
            fullPath,
          });

          files.push({
            name: entry.name,
            path: fullPath,
            relativePath: currentRelativePath
          });
        }
      }
    } catch (error) {
      console.error(`${debugPrefix} 目录处理失败`, {
        dirPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 开始处理根目录
  const rootPath = workspace.isCustom ? workspace.path : 'article';
  console.log('[getAllMarkdownFiles] 开始处理根目录', {
    rootPath,
    useCustomPath: workspace.isCustom,
  });

  await processDirectory(rootPath, workspace.isCustom);

  console.log('[getAllMarkdownFiles] 完成', {
    totalFiles: files.length,
    files: files.map(f => ({ name: f.name, relativePath: f.relativePath })),
  });

  return files;
}