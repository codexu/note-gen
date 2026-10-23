import { exists, remove } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import type { DirTree } from "@/stores/article";
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from "@/types/sync";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { getDirectoryFiles as getGithubDirectoryFiles } from "@/lib/sync/github";
import { getDirectoryFiles as getGiteeDirectoryFiles } from "@/lib/sync/gitee";
import { getDirectoryFiles as getGitlabDirectoryFiles } from "@/lib/sync/gitlab";
import { getDirectoryFiles as getGiteaDirectoryFiles } from "@/lib/sync/gitea";
import { s3ListObjects } from "@/lib/sync/s3";
import { webdavDelete } from "@/lib/sync/webdav";
import { androidCloudFolderWorkspaceDelete, supportsCloudFolderWorkspace } from "@/lib/sync/cloud-folder";
import { deleteRemoteFile } from "@/lib/sync/remote-library";
import { captureWorkspaceRemoteWriteGuard } from "@/lib/sync/workspace-remote-write-guard";
import type { RemoteDirectoryEntry } from "@/lib/sync/directory-listing";

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

function isGitPlatform(platform: SyncPlatform): platform is GitSyncPlatform {
  return platform === "github" || platform === "gitee" || platform === "gitlab" || platform === "gitea";
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function isStringPath(path: string | undefined): path is string {
  return Boolean(path);
}

function normalizeFolderPath(folderPath: string) {
  return folderPath.replace(/^\/+|\/+$/g, "");
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

async function getGitRemoteEntries(
  platform: GitSyncPlatform, path: string, repo: string, cache: Map<string, Promise<unknown>>,
): Promise<RemoteDirectoryEntry[]> {
  switch (platform) {
    case "github": return getGithubDirectoryFiles({ path, repo, cache });
    case "gitee": return getGiteeDirectoryFiles({ path, repo, cache });
    case "gitlab": return getGitlabDirectoryFiles({ path, repo });
    case "gitea": return getGiteaDirectoryFiles({ path, repo });
  }
}

async function collectGitRemoteFileEntries(platform: GitSyncPlatform, folderPath: string, repo: string) {
  const entries: RemoteDirectoryEntry[] = [];
  const visitedPaths = new Set<string>();
  const cache = new Map<string, Promise<unknown>>();

  async function walk(path: string) {
    if (visitedPaths.has(path)) throw new Error("Repeated remote directory");
    visitedPaths.add(path);
    const children = await getGitRemoteEntries(platform, path, repo, cache);
    for (const entry of children) {
      if (!entry.path.startsWith(`${path}/`) || entry.path.split("/").some(part => part === ".." || part === ".")) {
        throw new Error("Remote directory contains an invalid path");
      }
      if (entry.type === "dir") await walk(entry.path);
      else entries.push(entry);
    }
  }

  await walk(folderPath);
  return entries;
}

async function deleteListedRemoteFiles(
  platform: SyncPlatform,
  entries: Array<{ path: string; version: string }>,
  beforeDelete?: () => Promise<void>,
): Promise<DeleteRemoteFolderResult> {
  const result: DeleteRemoteFolderResult = { attempted: true, deletedPaths: [], failedPaths: [] };
  for (const entry of entries) {
    try {
      await beforeDelete?.();
      if (!await deleteRemoteFile(entry.path, "workspace", { version: entry.version }, platform, beforeDelete)) {
        throw new Error("Remote deletion failed");
      }
      result.deletedPaths.push(entry.path);
    } catch (error) {
      console.error(`Delete remote folder entry failed: ${entry.path}`, error);
      result.failedPaths.push(entry.path);
    }
  }
  return result;
}

export async function deleteRemoteFolder(
  item: DirTree,
  localDeleted: boolean,
  target?: SyncPlatform,
  beforeDelete?: () => Promise<void>,
): Promise<DeleteRemoteFolderResult> {
  const store = await Store.load("store.json");
  const platform = target ?? await store.get<SyncPlatform>("primaryBackupMethod") ?? "github";
  const folderPath = normalizeFolderPath(computedParentPath(item));
  if (!folderPath || folderPath.split("/").some(part => part === ".." || part === ".")) {
    throw new Error("Invalid folder deletion path");
  }
  if (localDeleted && !hasRemoteFolderData(item)) {
    return { attempted: false, deletedPaths: [], failedPaths: [] };
  }
  await beforeDelete?.();

  if (isGitPlatform(platform)) {
    const repo = await getSyncRepoName(platform);
    const entries = await collectGitRemoteFileEntries(platform, folderPath, repo);
    const result = await deleteListedRemoteFiles(platform,
      entries.map(entry => ({ path: entry.path, version: entry.sha })), beforeDelete);
    if (result.failedPaths.length === 0) {
      await beforeDelete?.();
      // Re-read rather than reusing the inventory: another client may have added a file.
      const remaining = await collectGitRemoteFileEntries(platform, folderPath, repo);
      result.failedPaths.push(...remaining.map(entry => entry.path));
    }
    return result;
  }

  if (platform === "s3") {
    const config = await store.get<S3Config>("s3SyncConfig");
    if (!config) throw new Error("S3 is not configured");
    const entries = (await s3ListObjects(config, folderPath))
      .filter(entry => entry.key.startsWith(`${folderPath}/`));
    const result = await deleteListedRemoteFiles(platform,
      entries.map(entry => ({ path: entry.key, version: entry.etag })), beforeDelete);
    if (result.failedPaths.length === 0) {
      await beforeDelete?.();
      const remaining = await s3ListObjects(config, folderPath);
      result.failedPaths.push(...remaining.filter(entry => entry.key.startsWith(`${folderPath}/`)).map(entry => entry.key));
    }
    return result;
  }

  const beforeWrite = await captureWorkspaceRemoteWriteGuard(folderPath, platform, false);
  const guard = async () => { await beforeDelete?.(); await beforeWrite?.(); };
  if (platform === "cloudFolder") {
    const config = await store.get<CloudFolderConfig>("cloudFolderSyncConfig");
    if (!config?.path || !supportsCloudFolderWorkspace(config)) {
      throw new Error("Cloud folder does not support remote workspace deletion");
    }
    const deleted = await androidCloudFolderWorkspaceDelete(config, folderPath, undefined, guard);
    return { attempted: true, deletedPaths: deleted ? [folderPath] : [], failedPaths: deleted ? [] : [folderPath] };
  }
  if (platform !== "webdav") throw new Error("Remote folder deletion is unavailable");
  const config = await store.get<WebDAVConfig>("webdavSyncConfig");
  if (!config) throw new Error("WebDAV is not configured");
  const deleted = await webdavDelete(config, folderPath, undefined, undefined, guard);
  return { attempted: true, deletedPaths: deleted ? [folderPath] : [], failedPaths: deleted ? [] : [folderPath] };
}
