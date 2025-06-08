import { useRouter as useNextRouter, usePathname as useNextPathname } from 'next/navigation';

// Simple navigation hooks that work with static export
export const useRouter = () => {
  return useNextRouter();
};

export const usePathname = () => {
  return useNextPathname();
};

// For static export, we'll just use regular Next.js navigation
export { default as Link } from 'next/link'; 