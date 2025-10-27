// Gitea 实例类型枚举
export enum GiteaInstanceType {
  OFFICIAL = 'gitea.com',      // 官方实例
  SELF_HOSTED = 'self-hosted'   // 自建实例
}

// Gitea 实例配置
export interface GiteaInstanceConfig {
  type: GiteaInstanceType;
  baseUrl: string;
  name: string;
  description: string;
}

// 预定义的 Gitea 实例配置
export const GITEA_INSTANCES: Record<GiteaInstanceType, GiteaInstanceConfig> = {
  [GiteaInstanceType.OFFICIAL]: {
    type: GiteaInstanceType.OFFICIAL,
    baseUrl: 'https://gitea.com',
    name: 'Gitea.com',
    description: '官方 Gitea 实例'
  },
  [GiteaInstanceType.SELF_HOSTED]: {
    type: GiteaInstanceType.SELF_HOSTED,
    baseUrl: '',
    name: '自建实例',
    description: '自建 Gitea 服务器'
  }
};

// Gitea 错误类型
export interface GiteaError {
  status: number;
  message: string;
}

// Gitea 用户信息类型
export interface GiteaUserInfo {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
  html_url?: string; // 用户主页 URL
  language: string;
  is_admin: boolean;
  last_login: string;
  created: string;
  restricted: boolean;
  active: boolean;
  prohibit_login: boolean;
  location: string;
  website: string;
  description: string;
  visibility: string;
  followers_count: number;
  following_count: number;
  starred_repos_count: number;
  username: string;
}

// Gitea 仓库信息类型
export interface GiteaRepositoryInfo {
  id: number;
  owner: {
    id: number;
    login: string;
    full_name: string;
    email: string;
    avatar_url: string;
    language: string;
    is_admin: boolean;
    last_login: string;
    created: string;
    restricted: boolean;
    active: boolean;
    prohibit_login: boolean;
    location: string;
    website: string;
    description: string;
    visibility: string;
    followers_count: number;
    following_count: number;
    starred_repos_count: number;
    username: string;
  };
  name: string;
  full_name: string;
  description: string;
  empty: boolean;
  private: boolean;
  fork: boolean;
  template: boolean;
  parent: null;
  mirror: boolean;
  size: number;
  language: string;
  languages_url: string;
  html_url: string;
  ssh_url: string;
  clone_url: string;
  original_url: string;
  website: string;
  stars_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  open_pr_counter: number;
  release_counter: number;
  default_branch: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
  has_issues: boolean;
  internal_tracker: {
    enable_time_tracker: boolean;
    allow_only_contributors_to_track_time: boolean;
    enable_issue_dependencies: boolean;
  };
  has_wiki: boolean;
  has_pull_requests: boolean;
  has_projects: boolean;
  ignore_whitespace_conflicts: boolean;
  allow_merge_commits: boolean;
  allow_rebase: boolean;
  allow_rebase_explicit: boolean;
  allow_squash_merge: boolean;
  default_merge_style: string;
  avatar_url: string;
  internal: boolean;
  mirror_interval: string;
  mirror_updated: string;
}

// Gitea 文件内容类型
export interface GiteaFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: string;
  content?: string;  // base64 编码的内容
  encoding?: string;
  _links: {
    self: string;
    git: string;
    html: string;
  };
}

// Gitea 目录内容类型
export interface GiteaDirectoryItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: 'file' | 'dir';
  _links: {
    self: string;
    git: string;
    html: string;
  };
}

// Gitea 提交信息类型
export interface GiteaCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
      url: string;
    };
    verification: {
      verified: boolean;
      reason: string;
      signature: string;
      payload: string;
    };
  };
  url: string;
  html_url: string;
  parents: Array<{
    sha: string;
    url: string;
  }>;
  author: {
    id: number;
    login: string;
    full_name: string;
    email: string;
    avatar_url: string;
    language: string;
    is_admin: boolean;
    last_login: string;
    created: string;
    username: string;
  };
  committer: {
    id: number;
    login: string;
    full_name: string;
    email: string;
    avatar_url: string;
    language: string;
    is_admin: boolean;
    last_login: string;
    created: string;
    username: string;
  };
  created: string;
}

// Gitea API 响应类型
export type GiteaResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

// 同步状态枚举（复用现有的）
export { SyncStateEnum } from './github.types';

// 仓库名称枚举（复用现有的）
export { RepoNames } from './github.types';
