import { exists, remove } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import type { DirTree } from "@/stores/article";
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from "@/types/sync";
import { computedParentPath, getCurrentFolder, joinRelativePath } from "@/lib/path";
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { deleteFile as deleteGithubFile, getFiles as getGithubFiles } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile, getFiles as getGiteeFiles } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile, getFiles as getGitlabFiles } from "@/lib/sync/gitlab";
import { deleteFile as deleteGiteaFile, getFiles as getGiteaFiles } from "@/lib/sync/gitea";
import { s3Delete, s3ListObjects } from "@/lib/sync/s3";
import { webdavDelete } from "@/lib/sync/webdav";
import { androidCloudFolderWorkspaceDelete } from "@/lib/sync/cloud-folder";

type GitSyncPlatform = Extract<SyncPlatform, "github" | "gitee" | "gitlab" | "gitea">;

interface RemoteContentEntry {
  name?: string;
  path?: string;
  type?: string;
  sha?: string;
}

export interface DeleteRemoteFolderResult {
  attempted: boolean;
  deletedPaths: string[];
  failedPaths: string[];
}

function isRemoteContentEntry(value: unknown): value is RemoteContentEntry {
  return typeof value === "object" && value !== null;
}

function isGitPlatform(platform: SyncPlatform): platform is GitSyncPlatform {
  return platform === "github" || platform === "gitee" || platform === "gitlab" || platform === "gitea";
}

function isDirectoryEntry(entry: RemoteContentEntry) {
  const type = entry.type?.toLowerCase();
  return type === "dir" || type === "tree";
}

function isFileEntry(entry: RemoteContentEntry) {
  const type = entry.type?.toLowerCase();
  return type === "file" || type === "blob" || (!type && Boolean(entry.path));
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function isStringPath(path: string | undefined): path is string {
  return Boolean(path);
}

function normalizeFolderPath(folderPath: string) {
  return folderPath.trim().replace(/^\/+|\/+$/g, "");
}

function joinListedObjectPath(folderPath: string, key: string) {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  const normalizedKey = key.replace(/^\/+|\/+$/g, "");

  if (!normalizedFolderPath) {
    return normalizedKey;
  }

  if (!normalizedKey || normalizedKey === normalizedFolderPath || normalizedKey.startsWith(`${normalizedFolderPath}/`)) {
    return normalizedKey;
  }

  return joinRelativePath(normalizedFolderPath, normalizedKey);
}

function isMarkdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
}

export function collectFolderFilePaths(item: DirTree): string[] {
  return uniquePaths(collectFolderFileEntries(item).map(entry => entry.path).filter(isStringPath));
}

function collectFolderFileEntries(item: DirTree): RemoteContentEntry[] {
  const entries: RemoteContentEntry[] = [];

  function walk(node: DirTree) {
    if (node.isFile) {
      entries.push({
        path: computedParentPath(node),
        name: node.name,
        sha: node.sha,
        type: "file",
      });
      return;
    }

    node.children?.forEach(walk);
  }

  walk(item);
  return entries;
}

export function hasRemoteFolderData(item: DirTree) {
  let hasRemoteData = Boolean(item.sha) || !item.isLocale;

  function walk(node: DirTree) {
    if (hasRemoteData) {
      return;
    }

    hasRemoteData = Boolean(node.sha) || !node.isLocale;
    node.children?.forEach(walk);
  }

  walk(item);
  return hasRemoteData;
}

export async function collectFolderMarkdownPaths(folderPath: string, item: DirTree) {
  const folderPrefix = `${normalizeFolderPath(folderPath)}/`;
  const paths = new Set(collectFolderFilePaths(item).filter(isMarkdownPath));

  try {
    const { getAllMarkdownFiles } = await import("@/lib/files");
    const allFiles = await getAllMarkdownFiles();
    allFiles
      .filter(file => file.relativePath.startsWith(folderPrefix))
      .forEach(file => paths.add(file.relativePath));
  } catch {
    // 本地目录不存在时，仍然可以依赖当前树节点清理已知的向量记录。
  }

  return Array.from(paths);
}

export async function deleteVectorDocumentsByPaths(paths: string[], folderPath?: string) {
  if (paths.length === 0 && !folderPath) {
    return;
  }

  if (folderPath) {
    const { deleteVectorDocumentsByPrefix } = await import("@/db/vector");
    try {
      await deleteVectorDocumentsByPrefix(folderPath);
      return;
    } catch (error) {
      console.error(`删除文件夹 ${folderPath} 的向量数据失败，将逐文件重试:`, error);
    }
  }

  const { deleteVectorDocumentsByFilename } = await import("@/db/vector");
  for (const path of paths) await deleteVectorDocumentsByFilename(path);
}

export async function deleteLocalFolderIfExists(folderPath: string) {
  const workspace = await getWorkspacePath();
  const pathOptions = await getFilePathOptions(folderPath);
  const localExists = workspace.isCustom
    ? await exists(pathOptions.path)
    : await exists(pathOptions.path, { baseDir: pathOptions.baseDir });

  if (!localExists) {
    return false;
  }

  if (workspace.isCustom) {
    await remove(pathOptions.path, { recursive: true });
  } else {
    await remove(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true });
  }

  return true;
}

export function removeFolderFromTree(tree: DirTree[], folderPath: string) {
  const currentFolder = getCurrentFolder(folderPath, tree);
  if (!currentFolder) {
    return;
  }

  const parentFolder = currentFolder?.parent;

  if (parentFolder?.children) {
    const index = parentFolder.children.findIndex(child => child.name === currentFolder.name);
    if (index !== -1) {
      parentFolder.children.splice(index, 1);
    }
    return;
  }

  const rootName = folderPath.split("/")[0];
  const index = tree.findIndex(child => child.name === rootName);
  if (index !== -1) {
    tree.splice(index, 1);
  }
}

export function clearFolderRemoteState(tree: DirTree[], folderPath: string) {
  const currentFolder = getCurrentFolder(folderPath, tree)
  if (!currentFolder) return

  function clearNode(node: DirTree): DirTree | null {
    if (!node.isLocale) return null

    node.sha = undefined
    node.loading = undefined
    node.syncDirty = false
    node.syncError = undefined
    if (node.children) {
      node.children = node.children
        .map(clearNode)
        .filter((child): child is DirTree => child !== null)
      node.children.forEach(child => {
        child.parent = node
      })
    }
    return node
  }

  if (!clearNode(currentFolder)) {
    removeFolderFromTree(tree, folderPath)
  }
}

export function clearFolderLocalState(tree: DirTree[], folderPath: string) {
  const currentFolder = getCurrentFolder(folderPath, tree)
  if (!currentFolder) return

  function clearNode(node: DirTree): DirTree | null {
    if (node.isFile) {
      if (!node.sha && node.isLocale) return null
      node.isLocale = false
      node.loading = undefined
      node.syncDirty = false
      node.syncError = undefined
      return node
    }

    node.children = (node.children ?? [])
      .map(clearNode)
      .filter((child): child is DirTree => child !== null)
    node.children.forEach(child => {
      child.parent = node
    })

    if (node.isLocale && node.children.length === 0) return null
    node.isLocale = false
    node.loading = undefined
    node.syncDirty = false
    node.syncError = undefined
    return node
  }

  if (!clearNode(currentFolder)) {
    removeFolderFromTree(tree, folderPath)
  }
}

async function getGitRemoteEntries(platform: GitSyncPlatform, path: string, repo: string): Promise<unknown> {
  switch (platform) {
    case "github":
      return getGithubFiles({ path, repo });
    case "gitee":
      return getGiteeFiles({ path, repo });
    case "gitlab":
      return getGitlabFiles({ path, repo });
    case "gitea":
      return getGiteaFiles({ path, repo });
  }
}

async function collectGitRemoteFileEntries(platform: GitSyncPlatform, folderPath: string, repo: string) {
  const entries: RemoteContentEntry[] = [];
  const visitedPaths = new Set<string>();

  async function walk(path: string) {
    if (visitedPaths.has(path)) {
      return;
    }

    visitedPaths.add(path);
    const response = await getGitRemoteEntries(platform, path, repo);

    if (Array.isArray(response)) {
      for (const entry of response.filter(isRemoteContentEntry)) {
        if (!entry.path) {
          continue;
        }

        if (isDirectoryEntry(entry)) {
          await walk(entry.path);
        } else if (isFileEntry(entry)) {
          entries.push(entry);
        }
      }
      return;
    }

    if (isRemoteContentEntry(response) && isFileEntry(response)) {
      entries.push(response);
    }
  }

  await walk(folderPath);
  return entries;
}

async function deleteGitRemoteFile(platform: GitSyncPlatform, entry: RemoteContentEntry, repo: string) {
  const path = entry.path;
  if (!path) {
    return false;
  }

  const sha = entry.sha || "";

  switch (platform) {
    case "github": {
      const result = await deleteGithubFile({ path, sha, repo });
      return Boolean(result);
    }
    case "gitee": {
      const result = await deleteGiteeFile({ path, sha, repo });
      return result !== false && result !== undefined;
    }
    case "gitlab": {
      const result = await deleteGitlabFile({ path, sha, repo });
      return Boolean(result);
    }
    case "gitea": {
      const result = await deleteGiteaFile({ path, sha, repo });
      return Boolean(result);
    }
  }
}

async function deleteGitRemoteFolder(
  platform: GitSyncPlatform,
  folderPath: string,
  loadedFileEntries: RemoteContentEntry[]
) {
  const repo = await getSyncRepoName(platform);
  const remoteEntries = await collectGitRemoteFileEntries(platform, folderPath, repo);
  const entries = remoteEntries.length > 0
    ? remoteEntries
    : loadedFileEntries;

  const result: DeleteRemoteFolderResult = {
    attempted: entries.length > 0,
    deletedPaths: [],
    failedPaths: [],
  };

  for (const entry of entries) {
    const path = entry.path;
    if (!path) {
      continue;
    }

    const deleted = await deleteGitRemoteFile(platform, entry, repo);
    if (deleted) {
      result.deletedPaths.push(path);
    } else {
      result.failedPaths.push(path);
    }
  }

  return result;
}

async function deleteS3RemoteFolder(config: S3Config, folderPath: string, loadedFilePaths: string[]) {
  const listedObjects = await s3ListObjects(config, folderPath);
  const objectKeys = listedObjects.map(object => joinListedObjectPath(folderPath, object.key));
  const keys = uniquePaths(objectKeys.length > 0 ? objectKeys : loadedFilePaths);

  const result: DeleteRemoteFolderResult = {
    attempted: keys.length > 0,
    deletedPaths: [],
    failedPaths: [],
  };

  for (const key of keys) {
    const deleted = await s3Delete(config, key);
    if (deleted) {
      result.deletedPaths.push(key);
    } else {
      result.failedPaths.push(key);
    }
  }

  return result;
}

async function deleteWebDAVRemoteFolder(config: WebDAVConfig, folderPath: string) {
  const deleted = await webdavDelete(config, folderPath);
  return {
    attempted: true,
    deletedPaths: deleted ? [folderPath] : [],
    failedPaths: deleted ? [] : [folderPath],
  } satisfies DeleteRemoteFolderResult;
}

export async function deleteRemoteFolder(item: DirTree, localDeleted: boolean) {
  const store = await Store.load("store.json");
  const platform = await store.get<SyncPlatform>("primaryBackupMethod") || "github";
  const folderPath = computedParentPath(item);
  const loadedFileEntries = collectFolderFileEntries(item);
  const loadedFilePaths = loadedFileEntries.map(entry => entry.path).filter(isStringPath);

  if (localDeleted && !hasRemoteFolderData(item)) {
    return {
      attempted: false,
      deletedPaths: [],
      failedPaths: [],
    } satisfies DeleteRemoteFolderResult;
  }

  if (isGitPlatform(platform)) {
    return deleteGitRemoteFolder(platform, folderPath, loadedFileEntries);
  }

  if (platform === "s3") {
    const config = await store.get<S3Config>("s3SyncConfig");
    if (!config) {
      return {
        attempted: false,
        deletedPaths: [],
        failedPaths: [],
      } satisfies DeleteRemoteFolderResult;
    }

    return deleteS3RemoteFolder(config, folderPath, loadedFilePaths);
  }

  if (platform === "cloudFolder") {
    const config = await store.get<CloudFolderConfig>("cloudFolderSyncConfig");
    if (config?.provider !== "oneDrive" || !config.path) {
      return {
        attempted: false,
        deletedPaths: [],
        failedPaths: [],
      } satisfies DeleteRemoteFolderResult;
    }

    const deleted = await androidCloudFolderWorkspaceDelete(config, folderPath);
    return {
      attempted: true,
      deletedPaths: deleted ? [folderPath] : [],
      failedPaths: deleted ? [] : [folderPath],
    } satisfies DeleteRemoteFolderResult;
  }

  const config = await store.get<WebDAVConfig>("webdavSyncConfig");
  if (!config) {
    return {
      attempted: false,
      deletedPaths: [],
      failedPaths: [],
    } satisfies DeleteRemoteFolderResult;
  }

  return deleteWebDAVRemoteFolder(config, folderPath);
}
