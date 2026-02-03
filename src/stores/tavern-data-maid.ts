'use client';

import { create } from 'zustand';

/**
 * 数据问题类型
 */
export type DataIssueType =
  | 'orphan_chat' // 孤立聊天 (角色已删除)
  | 'orphan_image' // 孤立图片
  | 'duplicate_character' // 重复角色
  | 'empty_chat' // 空聊天
  | 'corrupted_data' // 损坏数据
  | 'large_file' // 大文件
  | 'unused_backup' // 未使用的备份;

/**
 * 数据问题
 */
export interface DataIssue {
  id: string;
  type: DataIssueType;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  affectedItems: string[];
  suggestedAction: string;
  autoFixable: boolean;
  size?: number; // 占用空间 (bytes)
}

/**
 * 扫描结果
 */
export interface ScanResult {
  totalIssues: number;
  totalSize: number; // 可清理空间
  issues: DataIssue[];
  scannedAt: number;
  duration: number;
}

interface DataMaidStore {
  // 扫描状态
  isScanning: boolean;
  scanProgress: number;
  lastScanResult: ScanResult | null;
  
  // 选中的问题
  selectedIssues: Set<string>;
  
  // Actions
  startScan: () => void;
  updateProgress: (progress: number) => void;
  completeScan: (result: ScanResult) => void;
  
  // 问题选择
  toggleIssue: (issueId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  
  // 修复
  fixIssue: (issueId: string) => Promise<boolean>;
  fixSelected: () => Promise<number>;
  
  // 重置
  reset: () => void;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 获取问题类型标签
 */
export function getIssueTypeLabel(type: DataIssueType): string {
  const labels: Record<DataIssueType, string> = {
    orphan_chat: '孤立聊天',
    orphan_image: '孤立图片',
    duplicate_character: '重复角色',
    empty_chat: '空聊天',
    corrupted_data: '损坏数据',
    large_file: '大文件',
    unused_backup: '未使用备份',
  };
  return labels[type];
}

/**
 * 获取严重程度颜色
 */
export function getSeverityColor(severity: 'low' | 'medium' | 'high'): string {
  const colors = {
    low: 'text-blue-500',
    medium: 'text-yellow-500',
    high: 'text-red-500',
  };
  return colors[severity];
}

export const useDataMaidStore = create<DataMaidStore>((set, get) => ({
  isScanning: false,
  scanProgress: 0,
  lastScanResult: null,
  selectedIssues: new Set(),

  startScan: () => {
    set({
      isScanning: true,
      scanProgress: 0,
      selectedIssues: new Set(),
    });
  },

  updateProgress: (progress) => {
    set({ scanProgress: progress });
  },

  completeScan: (result) => {
    set({
      isScanning: false,
      scanProgress: 100,
      lastScanResult: result,
    });
  },

  toggleIssue: (issueId) => {
    set((state) => {
      const newSelected = new Set(state.selectedIssues);
      if (newSelected.has(issueId)) {
        newSelected.delete(issueId);
      } else {
        newSelected.add(issueId);
      }
      return { selectedIssues: newSelected };
    });
  },

  selectAll: () => {
    const result = get().lastScanResult;
    if (!result) return;
    set({
      selectedIssues: new Set(
        result.issues.filter((i) => i.autoFixable).map((i) => i.id)
      ),
    });
  },

  deselectAll: () => {
    set({ selectedIssues: new Set() });
  },

  fixIssue: async (issueId) => {
    // 实际修复逻辑需要根据问题类型实现
    // 这里只是模拟
    const result = get().lastScanResult;
    if (!result) return false;

    const issue = result.issues.find((i) => i.id === issueId);
    if (!issue || !issue.autoFixable) return false;

    // 模拟修复
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 从结果中移除已修复的问题
    set((state) => ({
      lastScanResult: state.lastScanResult
        ? {
            ...state.lastScanResult,
            issues: state.lastScanResult.issues.filter((i) => i.id !== issueId),
            totalIssues: state.lastScanResult.totalIssues - 1,
            totalSize: state.lastScanResult.totalSize - (issue.size || 0),
          }
        : null,
      selectedIssues: new Set(
        [...state.selectedIssues].filter((id) => id !== issueId)
      ),
    }));

    return true;
  },

  fixSelected: async () => {
    const selected = get().selectedIssues;
    let fixed = 0;

    for (const issueId of selected) {
      const success = await get().fixIssue(issueId);
      if (success) fixed++;
    }

    return fixed;
  },

  reset: () => {
    set({
      isScanning: false,
      scanProgress: 0,
      lastScanResult: null,
      selectedIssues: new Set(),
    });
  },
}));
