'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push('/core/record');
    }, 5000);

    // Update countdown timer every second
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
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-4">404 - Page Not Found</h1>
      <div className="text-center">
        <p className="mb-6">Redirecting to the record page in {countdown} seconds...</p>
        <Button onClick={() => router.push('/core/record')}>Go to Record Page Now</Button>
      </div>
    </div>
  );
}
