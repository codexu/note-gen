import { Highlighter } from "lucide-react";
import { _t } from '@/locales';

export default function MarkEmpty() {
  return <div className="flex flex-col justify-center items-center flex-1 w-full pt-32">
    <Highlighter className="size-16 opacity-10 mb-2" />
    <p className='text-zinc-500 opacity-30'>{_t('no_records')}</p>
  </div>
}
