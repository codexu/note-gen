'use client'
import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Folder } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import useSettingStore from '@/stores/setting'

const textSizeOptions = [
  { value: 'xs', label: 'XS', desc: '12px' },
  { value: 'sm', label: 'SM', desc: '14px' },
  { value: 'md', label: 'MD', desc: '16px' },
  { value: 'lg', label: 'LG', desc: '18px' },
  { value: 'xl', label: 'XL', desc: '20px' },
]

export function FileManagerTextSizeSettings() {
  const t = useTranslations('settings.general.interface')
  const { fileManagerTextSize, setFileManagerTextSize } = useSettingStore()

  const handleSizeChange = (value: string) => {
    setFileManagerTextSize(value)
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Folder className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('fileManagerTextSize.title')}</ItemTitle>
        <ItemDescription>{t('fileManagerTextSize.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select value={fileManagerTextSize} onValueChange={handleSizeChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {textSizeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="text-center w-full">{option.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ItemActions>
    </Item>
  )
}
