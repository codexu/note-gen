import { open } from '@tauri-apps/plugin-shell';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const OpenBroswer = ({ type = 'link', title, url, className }: { type?: 'link' | 'button', title: string, url: string, className?: string }) => {
  return (
    type === 'button' ?
    <Button onClick={() => {open(url)}}>{title}</Button> :
    <Link 
      className={`underline hover:text-zinc-900 ${className}`}
      href={'#'}
      onClick={() => {open(url)}}
    >{title}</Link>
  );
};