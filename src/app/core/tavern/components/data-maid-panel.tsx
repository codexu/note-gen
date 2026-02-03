'use client';

import { useState } from 'react';
import {
  Sparkles,
  Search,
  Trash2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  useDataMaidStore,
  type DataIssue,
  formatFileSize,
  getIssueTypeLabel,
  getSeverityColor,
} from '@/stores/tavern-data-maid';

/**
 * 严重程度图标
 */
function SeverityIcon({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const icons = {
    low: Info,
    medium: AlertTriangle,
    high: AlertCircle,
  };
  const Icon = icons[severity];
  return <Icon className={cn('h-4 w-4', getSeverityColor(severity))} />;
}

/**
 * 问题卡片
 */
function IssueCard({
  issue,
  isSelected,
  onToggle,
  onFix,
}: {
  issue: DataIssue;
  isSelected: boolean;
  onToggle: () => void;
  onFix: () => void;
}) {
  return (
    <div
      className={cn(
        'p-3 rounded-lg border transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'border-border'
      )}
    >
      <div className="flex items-start gap-3">
        {issue.autoFixable && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggle}
            className="mt-0.5"
          />
        )}
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityIcon severity={issue.severity} />
            <span className="font-medium text-sm">{issue.title}</span>
            <span className="text-xs px-1.5 py-0.5 bg-muted rounded">
              {getIssueTypeLabel(issue.type)}
            </span>
          </div>
          
          <p className="text-xs text-muted-foreground mb-2">
            {issue.description}
          </p>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{issue.affectedItems.length} 个项目</span>
              {issue.size && (
                <>
                  <span>·</span>
                  <span>{formatFileSize(issue.size)}</span>
                </>
              )}
            </div>
            
            {issue.autoFixable && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onFix}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                清理
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 数据清理面板
 */
export function DataMaidPanel() {
  const {
    isScanning,
    scanProgress,
    lastScanResult,
    selectedIssues,
    startScan,
    updateProgress,
    completeScan,
    toggleIssue,
    selectAll,
    deselectAll,
    fixIssue,
    fixSelected,
  } = useDataMaidStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  // 模拟扫描
  const handleScan = async () => {
    startScan();
    
    // 模拟扫描进度
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      updateProgress(i);
    }

    // 模拟扫描结果
    const mockIssues: DataIssue[] = [
      {
        id: '1',
        type: 'empty_chat',
        severity: 'low',
        title: '空聊天会话',
        description: '发现没有任何消息的聊天会话',
        affectedItems: ['chat_1', 'chat_2'],
        suggestedAction: '删除空聊天',
        autoFixable: true,
        size: 1024,
      },
      {
        id: '2',
        type: 'orphan_image',
        severity: 'medium',
        title: '孤立图片文件',
        description: '这些图片不属于任何角色或聊天',
        affectedItems: ['img_1.png', 'img_2.jpg'],
        suggestedAction: '删除孤立图片',
        autoFixable: true,
        size: 2048000,
      },
      {
        id: '3',
        type: 'unused_backup',
        severity: 'low',
        title: '过期备份',
        description: '超过30天的旧备份文件',
        affectedItems: ['backup_1', 'backup_2', 'backup_3'],
        suggestedAction: '删除旧备份',
        autoFixable: true,
        size: 5120000,
      },
    ];

    completeScan({
      totalIssues: mockIssues.length,
      totalSize: mockIssues.reduce((sum, i) => sum + (i.size || 0), 0),
      issues: mockIssues,
      scannedAt: Date.now(),
      duration: 2000,
    });
  };

  const handleFixSelected = async () => {
    setIsFixing(true);
    await fixSelected();
    setIsFixing(false);
  };

  const handleFixSingle = async (issueId: string) => {
    setIsFixing(true);
    await fixIssue(issueId);
    setIsFixing(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Sparkles className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>数据清理</TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            数据清理助手
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 扫描按钮 */}
          {!isScanning && !lastScanResult && (
            <div className="text-center py-8">
              <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                扫描并清理无用数据，释放存储空间
              </p>
              <Button onClick={handleScan}>
                <Search className="h-4 w-4 mr-2" />
                开始扫描
              </Button>
            </div>
          )}

          {/* 扫描进度 */}
          {isScanning && (
            <div className="py-8 space-y-4">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>正在扫描...</span>
              </div>
              <Progress value={scanProgress} />
              <p className="text-xs text-center text-muted-foreground">
                {scanProgress}% 完成
              </p>
            </div>
          )}

          {/* 扫描结果 */}
          {lastScanResult && !isScanning && (
            <>
              {/* 统计 */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">
                    发现 {lastScanResult.totalIssues} 个问题
                  </p>
                  <p className="text-xs text-muted-foreground">
                    可释放 {formatFileSize(lastScanResult.totalSize)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleScan}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  重新扫描
                </Button>
              </div>

              {lastScanResult.issues.length > 0 ? (
                <>
                  {/* 批量操作 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={selectAll}
                      >
                        全选
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={deselectAll}
                      >
                        取消
                      </Button>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      已选 {selectedIssues.size} 项
                    </span>
                  </div>

                  {/* 问题列表 */}
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2 pr-2">
                      {lastScanResult.issues.map((issue) => (
                        <IssueCard
                          key={issue.id}
                          issue={issue}
                          isSelected={selectedIssues.has(issue.id)}
                          onToggle={() => toggleIssue(issue.id)}
                          onFix={() => handleFixSingle(issue.id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p className="text-sm font-medium">数据很干净！</p>
                  <p className="text-xs text-muted-foreground">
                    没有发现需要清理的问题
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作 */}
        {lastScanResult && lastScanResult.issues.length > 0 && (
          <DialogFooter>
            <Button
              onClick={handleFixSelected}
              disabled={selectedIssues.size === 0 || isFixing}
            >
              {isFixing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              清理选中 ({selectedIssues.size})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
