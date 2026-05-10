export interface FolderSyncFilePayload {
  path: string
  content: string
  sha?: string
}

export interface GithubTreeEntry {
  path: string
  mode: '100644'
  type: 'blob'
  content: string
}

export interface GithubCreateTreePayload {
  base_tree: string
  tree: GithubTreeEntry[]
}

export interface GitlabCommitAction {
  action: 'create' | 'update'
  file_path: string
  content: string
  sha?: string
}

export function buildGithubTreeEntries(files: FolderSyncFilePayload[]): GithubTreeEntry[] {
  return files.map((file) => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    content: file.content,
  }))
}

export function buildGithubCreateTreePayload(
  files: FolderSyncFilePayload[],
  baseTreeSha: string
): GithubCreateTreePayload {
  return {
    base_tree: baseTreeSha,
    tree: buildGithubTreeEntries(files),
  }
}

export function buildGitlabCommitActions(files: FolderSyncFilePayload[]): GitlabCommitAction[] {
  return files.map((file) => ({
    action: file.sha ? 'update' : 'create',
    file_path: file.path,
    content: file.content,
    ...(file.sha ? { sha: file.sha } : {}),
  }))
}
