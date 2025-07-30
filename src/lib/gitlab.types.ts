// Gitlab 实例类型枚举
export enum GitlabInstanceType {
  OFFICIAL = 'gitlab.com',      // 官方国际版
  JIHULAB = 'gitlab.cn',        // 中国极狐版
  SELF_HOSTED = 'self-hosted'   // 自建实例
}

// Gitlab 实例配置
export interface GitlabInstanceConfig {
  type: GitlabInstanceType;
  baseUrl: string;
  name: string;
  description: string;
}

// 预定义的 Gitlab 实例配置
export const GITLAB_INSTANCES: Record<GitlabInstanceType, GitlabInstanceConfig> = {
  [GitlabInstanceType.OFFICIAL]: {
    type: GitlabInstanceType.OFFICIAL,
    baseUrl: 'https://gitlab.com',
    name: 'GitLab.com',
    description: '官方国际版 GitLab'
  },
  [GitlabInstanceType.JIHULAB]: {
    type: GitlabInstanceType.JIHULAB,
    baseUrl: 'https://jihulab.com',
    name: '极狐GitLab',
    description: '中国版 GitLab'
  },
  [GitlabInstanceType.SELF_HOSTED]: {
    type: GitlabInstanceType.SELF_HOSTED,
    baseUrl: '',
    name: '自建实例',
    description: '自建 GitLab 服务器'
  }
};

// Gitlab 错误类型
export interface GitlabError {
  status: number;
  message: string;
}

// Gitlab 用户信息类型
export interface GitlabUserInfo {
  id: number;
  username: string;
  name: string;
  state: string;
  avatar_url: string;
  web_url: string;
  created_at: string;
  bio: string;
  location: string;
  public_email: string;
  skype: string;
  linkedin: string;
  twitter: string;
  website_url: string;
  organization: string;
}

// Gitlab 项目信息类型
export interface GitlabProjectInfo {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  created_at: string;
  updated_at: string;
  default_branch: string;
  description: string;
  web_url: string;
  avatar_url: string;
  star_count: number;
  forks_count: number;
  last_activity_at: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: string;
    full_path: string;
    avatar_url: string;
    web_url: string;
  };
  visibility: 'private' | 'internal' | 'public';
  issues_enabled: boolean;
  merge_requests_enabled: boolean;
  wiki_enabled: boolean;
  jobs_enabled: boolean;
  snippets_enabled: boolean;
  container_registry_enabled: boolean;
  service_desk_enabled: boolean;
  can_create_merge_request_in: boolean;
  issues_access_level: string;
  repository_access_level: string;
  merge_requests_access_level: string;
  forking_access_level: string;
  wiki_access_level: string;
  builds_access_level: string;
  snippets_access_level: string;
  pages_access_level: string;
  analytics_access_level: string;
  container_registry_access_level: string;
  security_and_compliance_access_level: string;
  releases_access_level: string;
  environments_access_level: string;
  feature_flags_access_level: string;
  infrastructure_access_level: string;
  monitor_access_level: string;
  model_experiments_access_level: string;
  model_registry_access_level: string;
}

// Gitlab 文件信息类型
export interface GitlabFile {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content_sha256: string;
  ref: string;
  blob_id: string;
  commit_id: string;
  last_commit_id: string;
  content?: string; // 文件内容，base64 编码
}

// Gitlab 仓库文件列表项类型
export interface GitlabRepositoryFile {
  id: string;
  name: string;
  type: 'tree' | 'blob';
  path: string;
  mode: string;
}

// Gitlab 提交信息类型
export interface GitlabCommit {
  id: string;
  short_id: string;
  created_at: string;
  parent_ids: string[];
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  committer_name: string;
  committer_email: string;
  committed_date: string;
  trailers: Record<string, string>;
  web_url: string;
}

// Gitlab API 响应类型
export type GitlabResponse<T> = {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

// 同步状态枚举（复用现有的）
export { SyncStateEnum } from './github.types';

// 仓库名称枚举（复用现有的）
export { RepoNames } from './github.types';
