'use client';

import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="zh">
      <body>
        <div className="flex min-h-screen items-center justify-center p-4">
          <div className="w-full max-w-md space-y-4 text-center">
            <div className="flex justify-center">
              <AlertCircle className="h-16 w-16 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold mb-4">System Error</h2>
              <p className="text-sm text-muted-foreground">
                The application has encountered a problem, but we are working to fix it.
              </p>
              <div className="bg-muted p-3 rounded-md text-left text-xs">
                {error.message || 'Unknown error'}
              </div>
            </div>
            <div className="space-y-2">
              <Button 
                onClick={reset}
                className="w-full"
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
