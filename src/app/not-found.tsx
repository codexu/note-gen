'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { isMobileDevice } from '@/lib/check';
import { Store } from '@tauri-apps/plugin-store';

export default function NotFound() {
  const router = useRouter();
  const mobile = isMobileDevice()
  const fallbackPath = mobile ? '/mobile/record' : '/core/main'
  const fallbackLabel = mobile ? 'Record' : 'Main'
  const [countdown, setCountdown] = useState(2);

  async function resetRouteStore() {
    const store = await Store.load('store.json');
    await store.set('currentPage', fallbackPath)
    await store.delete('lastSettingPage')
    await store.delete('lastRecordPage')
    await store.save()
  }

  async function returnToFallback() {
    await resetRouteStore()

    if (typeof window !== 'undefined') {
      window.location.replace(fallbackPath)
      return
    }

    router.replace(fallbackPath)
  }

  useEffect(() => {
    void resetRouteStore()
  }, [fallbackPath])

  useEffect(() => {
    const timer = setTimeout(() => {
      void returnToFallback()
    }, 2000);

    const countdownInterval = setInterval(() => {
      setCountdown((prevCount) => {
        if (prevCount <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);

    // Cleanup on component unmount
    return () => {
      clearTimeout(timer);
      clearInterval(countdownInterval);
    };
  }, [fallbackPath, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-4">404 - Page Not Found</h1>
      <div className="text-center">
        <p className="mb-6">Redirecting to the {fallbackLabel} page in {countdown} seconds...</p>
        <Button onClick={() => void returnToFallback()}>Go to {fallbackLabel} Page Now</Button>
      </div>
    </div>
  );
}
