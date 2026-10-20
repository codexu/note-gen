import { open } from '@tauri-apps/plugin-shell';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const OpenBroswer = ({ type = 'link', title, url, className }: { type?: 'link' | 'button', title: string, url: string, className?: string }) => {
  return (
    type === 'button' ?
    <Button className={className} onClick={() => {open(url)}}>{title}</Button> :
    <Link 
      className={cn('underline hover:text-foreground', className)}
      href={'#'}
      onClick={() => {open(url)}}
    >{title}</Link>
  );
};
