import { readTextFile, readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { fetchEmbedding, rerankDocuments } from "./ai";
import { 
  upsertVectorDocument, 
  deleteVectorDocumentsByFilename, 
  getSimilarDocuments,
  initVectorDb
} from "@/db/vector";

// 重新导出initVectorDb，使其可在其他模块中导入
export { initVectorDb };
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { DirTree } from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { join } from "@tauri-apps/api/path";

// 默认分块大小和重叠大小（字符数）
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * 文本分块函数，用于将大文本分成小块
 */
export function chunkText(
  text: string, 
  chunkSize: number = DEFAULT_CHUNK_SIZE, 
  chunkOverlap: number = DEFAULT_CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];
  
  // 检查文本是否足够长，需要分块
  if (text.length <= chunkSize) {
    chunks.push(text);
    return chunks;
  }
  
  // 尝试在段落边界进行分块
  const paragraphs = text.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // 如果加上当前段落后超出了块大小，则保存当前块并开始新块
    if (currentChunk.length + paragraph.length + 2 > chunkSize) {
      // 如果当前块非空，保存它
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        // 保留重叠部分到新块
        const lastChunkParts = currentChunk.split('\n\n');
        const overlapLength = Math.min(chunkOverlap, currentChunk.length);
        const overlapParts = [];
        let currentLength = 0;
        
        // 从后向前取段落，直到达到重叠大小
        for (let i = lastChunkParts.length - 1; i >= 0; i--) {
          const part = lastChunkParts[i];
          if (currentLength + part.length + 2 <= overlapLength) {
            overlapParts.unshift(part);
            currentLength += part.length + 2;
          } else {
            break;
          }
        }
        
        currentChunk = overlapParts.join('\n\n');
      }
      
      // 如果单个段落过长，需要强制分割
      if (paragraph.length > chunkSize) {
        // 先尝试按句子分割
        const sentences = paragraph.split(/(?<=\.|\?|\!)\s+/);
        let sentenceChunk = '';
        
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length > chunkSize) {
            if (sentenceChunk) {
              chunks.push(sentenceChunk);
              // 保留重叠
              const overlapLength = Math.min(chunkOverlap, sentenceChunk.length);
              sentenceChunk = sentenceChunk.slice(-overlapLength);
            }
          }
          
          sentenceChunk += sentence + ' ';
        }
        
        if (sentenceChunk) {
          currentChunk += sentenceChunk;
        }
      } else {
        currentChunk += paragraph + '\n\n';
      }
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }
  
  // 添加最后一个块
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * 处理单个Markdown文件，计算向量并存储到数据库
 */
export async function processMarkdownFile(
  filePath: string, 
  fileContent?: string
): Promise<boolean> {
  try {
    const workspace = await getWorkspacePath()
    let content = ''
    if (workspace.isCustom) {
      content = fileContent || await readTextFile(filePath)
    } else {
      const { path, baseDir } = await getFilePathOptions(filePath)
      content = fileContent || await readTextFile(path, { baseDir })
    }
    const chunks = chunkText(content);
    
    // 文件名（不含路径）
    const filename = filePath.split('/').pop() || filePath;
    
    // 先删除该文件的旧记录
    await deleteVectorDocumentsByFilename(filename);
    
    // 处理每个文本块
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // 计算嵌入向量
      const embedding = await fetchEmbedding(chunk);
      
      if (!embedding) {
        console.error(`无法计算文件 ${filename} 第 ${i+1} 块的向量`);
        continue;
      }
      
      // 保存到数据库
      await upsertVectorDocument({
        filename,
        chunk_id: i,
        content: chunk,
        embedding: JSON.stringify(embedding),
        updated_at: Date.now()
      });
    }
    
    return true;
  } catch (error) {
    console.error(`处理文件 ${filePath} 失败:`, error);
    return false;
  }
}

/**
 * 获取工作区目录树
 */
async function getWorkspaceFiles(): Promise<DirTree[]> {
  const workspace = await getWorkspacePath();
  let entries: DirEntry[];
  
  if (workspace.isCustom) {
    entries = await readDir(workspace.path);
  } else {
    entries = await readDir('article', { baseDir: BaseDirectory.AppData });
  }
  
  // 转换为DirTree格式
  const result: DirTree[] = [];
  
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
    if (!entry.isDirectory && !entry.name.endsWith('.md')) continue;
    
    // 创建DirTree对象
    const item: DirTree = {
      name: entry.name,
      isFile: !entry.isDirectory,
      isDirectory: entry.isDirectory,
      isSymlink: false, // Tauri FS API不直接提供isSymlink
      children: [],
      isLocale: true,
      isEditing: false
    };
    
    // 如果是目录，递归读取子目录
    if (entry.isDirectory) {
      const childPath = await join(workspace.isCustom ? workspace.path : 'article', entry.name);
      
      let childEntries: DirEntry[];
      if (workspace.isCustom) {
        childEntries = await readDir(childPath);
      } else {
        childEntries = await readDir(childPath, { baseDir: BaseDirectory.AppData });
      }
      
      // 筛选有效文件
      childEntries = childEntries.filter(file => 
        file.name !== '.DS_Store' && 
        !file.name.startsWith('.') && 
        (file.isDirectory || file.name.endsWith('.md'))
      );
      
      // 递归处理子目录
      item.children = childEntries.map(childEntry => ({
        name: childEntry.name,
        isFile: !childEntry.isDirectory,
        isDirectory: childEntry.isDirectory,
        isSymlink: false,
        children: [],
        isLocale: true,
        isEditing: false,
        parent: item
      }));
    }
    
    result.push(item);
  }
  
  return result;
}

/**
 * 处理工作区中的所有Markdown文件
 */
export async function processAllMarkdownFiles(): Promise<{
  total: number;
  success: number;
  failed: number;
}> {
  try {
    // 获取工作区中的所有文件
    const fileTree = await getWorkspaceFiles();
    
    // 统计结果
    const result = {
      total: 0,
      success: 0,
      failed: 0
    };
    
    // 递归处理文件树
    async function processTree(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          result.total++;
          // 获取完整路径
          const filePath = await getFilePath(item);
          const success = await processMarkdownFile(filePath);
          if (success) {
            result.success++;
          } else {
            result.failed++;
          }
        }
        
        // 递归处理子目录
        if (item.children && item.children.length > 0) {
          await processTree(item.children);
        }
      }
    }
    
    await processTree(fileTree);
    
    return result;
  } catch (error) {
    console.error('处理工作区Markdown文件失败:', error);
    throw error;
  }
}

/**
 * 根据DirTree项获取完整文件路径
 */
async function getFilePath(item: DirTree): Promise<string> {
  const workspace = await getWorkspacePath();
  let path = item.name;
  let parent = item.parent;
  
  // 构建相对路径
  while (parent) {
    path = `${parent.name}/${path}`;
    parent = parent.parent;
  }
  
  // 转换为完整路径
  if (workspace.isCustom) {
    return await join(workspace.path, path);
  } else {
    return path; // 返回相对于AppData/article的路径
  }
}

/**
 * 根据查询文本获取相关上下文
 */
export async function getContextForQuery(query: string): Promise<string> {
  try {
    // 计算查询文本的向量
    const queryEmbedding = await fetchEmbedding(query);
    if (!queryEmbedding) {
      return '';
    }
    
    // 查询最相关的文档
    let similarDocs = await getSimilarDocuments(queryEmbedding, 5, 0.7);
    if (!similarDocs.length) {
      return '';
    }
    
    // 如果配置了重排序模型，使用它进一步优化结果
    similarDocs = await rerankDocuments(query, similarDocs);
    // 构建上下文，包括文件名和内容
    return similarDocs.map(doc => {
      return `文件：${doc.filename}\n${doc.content}\n`;
    }).join('\n---\n\n');
  } catch (error) {
    console.error('获取查询上下文失败:', error);
    return '';
  }
}
/**
 * 当文件被更新时处理，更新向量数据库
 */
export async function handleFileUpdate(filename: string, content: string): Promise<void> {
  if (!filename.endsWith('.md')) return;
  
  try {
    await processMarkdownFile(filename, content);
  } catch (error) {
    console.error(`更新文件 ${filename} 的向量失败:`, error);
  }
}

/**
 * 检查是否有嵌入模型可用
 */
export async function checkEmbeddingModelAvailable(): Promise<boolean> {
  try {
    // 尝试计算一个简单文本的向量
    const embedding = await fetchEmbedding('测试嵌入模型');
    return !!embedding;
  } catch (error) {
    console.error('嵌入模型检查失败:', error);
    return false;
  }
}

/**
 * 显示向量处理进度的toast
 */
export function showVectorProcessingToast(message: string) {
  toast({
    title: '向量数据库更新',
    description: message,
  });
}
