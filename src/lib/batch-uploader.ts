import { Store } from '@tauri-apps/plugin-store';
import { readTextFile, readDir } from '@tauri-apps/plugin-fs';
import { toast } from '@/hooks/use-toast';
import { getFilePathOptions, getWorkspacePath } from './workspace';
import { uploadFile as uploadGithubFile } from './github';
import { uploadFile as uploadGiteeFile } from './gitee';  
import { uploadFile as uploadGitlabFile } from './gitlab';
import { RepoNames } from './github.types';

export enum RepositoryProvider {
  GITHUB = 'github',
  GITEE = 'gitee',
  GITLAB = 'gitlab'
}

export interface FileItem {
  path: string;
  name: string;
  content?: string;
  relativePath?: string;
  isDirectory?: boolean;
}

export interface BatchUploadOptions {
  provider?: RepositoryProvider;
  repo?: RepoNames;
  basePath?: string;
  message?: string;
  preserveStructure?: boolean;
  includeSubfolders?: boolean;
  fileExtensions?: string[];
  onProgress?: (current: number, total: number, currentFile: string) => void;
  onError?: (error: Error, file: FileItem) => void;
}

export interface BatchUploadResult {
  success: boolean;
  totalFiles: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ file: FileItem; error: Error }>;
  duration: number;
}

export class BatchUploader {
  private store!: Store;
  private defaultOptions: BatchUploadOptions = {
    provider: RepositoryProvider.GITHUB,
    repo: RepoNames.sync,
    preserveStructure: true,
    includeSubfolders: true,
    fileExtensions: ['.md'],
    message: '批量上传文件'
  };

  constructor() {
    this.init();
  }

  private async init() {
    this.store = await Store.load('store.json');
  }

  /**
   * 批量上传文件或文件夹
   */
  async uploadBatch(
    sources: string | string[] | FileItem[],
    options: BatchUploadOptions = {}
  ): Promise<BatchUploadResult> {
    const startTime = Date.now();
    const config = { ...this.defaultOptions, ...options };
    
    if (!this.store) {
      await this.init();
    }

    // 获取默认提供商
    if (!config.provider) {
      config.provider = await this.store.get<RepositoryProvider>('primaryBackupMethod') || RepositoryProvider.GITHUB;
    }

    try {
      // 收集所有需要上传的文件
      const files = await this.collectFiles(sources, config);
      
      if (files.length === 0) {
        toast({
          title: '没有找到需要上传的文件',
          variant: 'destructive'
        });
        return this.createResult(false, 0, 0, 0, [], Date.now() - startTime);
      }

      // 执行批量上传
      return await this.performBatchUpload(files, config, startTime);
      
    } catch (error) {
      toast({
        title: '批量上传失败',
        description: (error as Error).message,
        variant: 'destructive'
      });
      return this.createResult(false, 0, 0, 0, [{ file: { path: '', name: '' }, error: error as Error }], Date.now() - startTime);
    }
  }

  /**
   * 收集需要上传的文件
   */
  private async collectFiles(
    sources: string | string[] | FileItem[],
    options: BatchUploadOptions
  ): Promise<FileItem[]> {
    const files: FileItem[] = [];
    const sourcesArray = Array.isArray(sources) ? sources : [sources];

    for (const source of sourcesArray) {
      if (typeof source === 'string') {
        // 字符串路径，需要判断是文件还是文件夹
        await this.collectFromPath(source, files, options);
      } else {
        // FileItem 对象
        files.push(source);
      }
    }

    return files;
  }

  /**
   * 从路径收集文件
   */
  private async collectFromPath(
    sourcePath: string, 
    files: FileItem[], 
    options: BatchUploadOptions,
    basePath?: string
  ): Promise<void> {
    try {
      const workspace = await getWorkspacePath();
      const pathOptions = await getFilePathOptions(sourcePath);
      
      let entries;
      try {
        if (workspace.isCustom) {
          entries = await readDir(pathOptions.path);
        } else {
          entries = await readDir(pathOptions.path, { baseDir: pathOptions.baseDir });
        }
        
        // 是文件夹，递归处理
        for (const entry of entries) {
          // 跳过隐藏文件/文件夹
          if (entry.name.startsWith('.')) {
            continue;
          }

          const entryPath = sourcePath ? `${sourcePath}/${entry.name}` : entry.name;
          const relativeToBase = basePath ? entryPath.substring(basePath.length + 1) : entryPath;

          if (entry.isDirectory) {
            if (options.includeSubfolders) {
              await this.collectFromPath(entryPath, files, options, basePath || sourcePath);
            }
          } else {
            // 检查文件扩展名
            if (this.shouldIncludeFile(entry.name, options.fileExtensions)) {
              files.push({
                path: entryPath,
                name: entry.name,
                relativePath: relativeToBase,
                isDirectory: false
              });
            }
          }
        }
      } catch {
        // 不是文件夹，当作文件处理
        if (this.shouldIncludeFile(sourcePath, options.fileExtensions)) {
          const fileName = sourcePath.split('/').pop() || sourcePath;
          const relativeToBase = basePath ? sourcePath.substring(basePath.length + 1) : sourcePath;
          
          files.push({
            path: sourcePath,
            name: fileName,
            relativePath: relativeToBase,
            isDirectory: false
          });
        }
      }
    } catch (error) {
      console.error(`收集文件失败 ${sourcePath}:`, error);
    }
  }

  /**
   * 检查是否应该包含该文件
   */
  private shouldIncludeFile(fileName: string, allowedExtensions?: string[]): boolean {
    if (!allowedExtensions || allowedExtensions.length === 0) {
      return true;
    }
    
    return allowedExtensions.some(ext => fileName.toLowerCase().endsWith(ext.toLowerCase()));
  }

  /**
   * 执行批量上传
   */
  private async performBatchUpload(
    files: FileItem[],
    options: BatchUploadOptions,
    startTime: number
  ): Promise<BatchUploadResult> {
    let successCount = 0;
    let failureCount = 0;
    const errors: Array<{ file: FileItem; error: Error }> = [];

    toast({
      title: `开始批量上传`,
      description: `准备上传 ${files.length} 个文件`
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        // 触发进度回调
        options.onProgress?.(i + 1, files.length, file.name);
        
        // 读取文件内容
        if (!file.content) {
          file.content = await this.readFileContent(file.path);
        }

        // 确定上传路径
        const uploadPath = options.preserveStructure && file.relativePath 
          ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/')) || undefined
          : options.basePath;

        // 执行上传
        const result = await this.uploadSingleFile(file, uploadPath, options);
        
        if (result) {
          successCount++;
        } else {
          failureCount++;
          errors.push({ file, error: new Error('上传失败，未知错误') });
        }
        
      } catch (error) {
        failureCount++;
        const uploadError = error as Error;
        errors.push({ file, error: uploadError });
        options.onError?.(uploadError, file);
        console.error(`上传文件失败 ${file.path}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    const success = failureCount === 0;

    toast({
      title: success ? '批量上传完成' : '批量上传完成（部分失败）',
      description: `成功: ${successCount}, 失败: ${failureCount}, 耗时: ${Math.round(duration / 1000)}s`,
      variant: success ? 'default' : 'destructive'
    });

    return this.createResult(success, files.length, successCount, failureCount, errors, duration);
  }

  /**
   * 读取文件内容
   */
  private async readFileContent(filePath: string): Promise<string> {
    const workspace = await getWorkspacePath();
    const pathOptions = await getFilePathOptions(filePath);
    
    if (workspace.isCustom) {
      return await readTextFile(pathOptions.path);
    } else {
      return await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir });
    }
  }

  /**
   * 上传单个文件
   */
  private async uploadSingleFile(
    file: FileItem,
    uploadPath: string | undefined,
    options: BatchUploadOptions
  ): Promise<any> {
    const base64Content = Buffer.from(file.content || '').toString('base64');
    const ext = file.name.split('.').pop() || '';
    
    const uploadParams = {
      ext,
      file: base64Content,
      filename: file.name,
      repo: options.repo!,
      path: uploadPath,
      message: options.message
    };

    switch (options.provider) {
      case RepositoryProvider.GITHUB:
        return await uploadGithubFile(uploadParams);
      case RepositoryProvider.GITEE:
        return await uploadGiteeFile(uploadParams as any);
      case RepositoryProvider.GITLAB:
        return await uploadGitlabFile(uploadParams);
      default:
        throw new Error(`不支持的提供商: ${options.provider}`);
    }
  }

  /**
   * 创建结果对象
   */
  private createResult(
    success: boolean,
    totalFiles: number,
    successCount: number,
    failureCount: number,
    errors: Array<{ file: FileItem; error: Error }>,
    duration: number
  ): BatchUploadResult {
    return {
      success,
      totalFiles,
      successCount,
      failureCount,
      errors,
      duration
    };
  }

  /**
   * 上传单个文件的便捷方法
   */
  async uploadFile(filePath: string, options: BatchUploadOptions = {}): Promise<BatchUploadResult> {
    return this.uploadBatch([filePath], { ...options, includeSubfolders: false });
  }

  /**
   * 上传整个文件夹的便捷方法
   */
  async uploadFolder(folderPath: string, options: BatchUploadOptions = {}): Promise<BatchUploadResult> {
    return this.uploadBatch([folderPath], { ...options, includeSubfolders: true });
  }

  /**
   * 验证提供商配置
   */
  async validateProvider(provider: RepositoryProvider): Promise<boolean> {
    if (!this.store) {
      await this.init();
    }

    try {
      switch (provider) {
        case RepositoryProvider.GITHUB:
          const githubToken = await this.store.get('accessToken');
          const githubUsername = await this.store.get('githubUsername');
          return !!(githubToken && githubUsername);
          
        case RepositoryProvider.GITEE:
          const giteeToken = await this.store.get('giteeAccessToken');
          const giteeUsername = await this.store.get('giteeUsername');
          return !!(giteeToken && giteeUsername);
          
        case RepositoryProvider.GITLAB:
          const gitlabToken = await this.store.get('gitlabAccessToken');
          const gitlabUsername = await this.store.get('gitlabUsername');
          return !!(gitlabToken && gitlabUsername);
          
        default:
          return false;
      }
    } catch (error) {
      console.error('验证提供商配置失败:', error);
      return false;
    }
  }
}

// 导出单例实例
export const batchUploader = new BatchUploader();

// 导出便捷函数
export async function uploadFiles(
  files: string | string[] | FileItem[],
  options: BatchUploadOptions = {}
): Promise<BatchUploadResult> {
  return batchUploader.uploadBatch(files, options);
}

export async function uploadSingleFile(
  filePath: string,
  options: BatchUploadOptions = {}
): Promise<BatchUploadResult> {
  return batchUploader.uploadFile(filePath, options);
}

export async function uploadFolder(
  folderPath: string,
  options: BatchUploadOptions = {}
): Promise<BatchUploadResult> {
  return batchUploader.uploadFolder(folderPath, options);
}