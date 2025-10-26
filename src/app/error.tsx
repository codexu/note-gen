'use client';

import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

export default function Error({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // 记录错误到控制台
    console.error('應用錯誤:', error);
  }, [error]);

  function reloadPage() {
    window.location.reload();
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-[200px]">
      <div className="bg-card p-6 rounded-lg border shadow max-w-md w-full">
        <h2 className="text-lg font-semibold mb-4">出错了</h2>
        <p className="text-sm text-muted-foreground mb-4">
          应用程序的这部分出现了问题，但您可以继续使用其他功能。
        </p>
        <p className="text-xs bg-muted p-2 rounded mb-4 overflow-auto max-h-[100px]">
          {error.message || '未知错误'}
        </p>
        <div className="flex justify-end">
          <Button onClick={reloadPage} variant="outline" size="sm">
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}
