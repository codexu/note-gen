'use client'
import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Bookmark } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import useSettingStore from '@/stores/setting'

const textSizeOptions = [
  { value: 'xs', label: 'XS', desc: '12px' },
  { value: 'sm', label: 'SM', desc: '14px' },
  { value: 'md', label: 'MD', desc: '16px' },
  { value: 'lg', label: 'LG', desc: '18px' },
  { value: 'xl', label: 'XL', desc: '20px' },
]

export function RecordTextSizeSettings() {
  const t = useTranslations('settings.general.interface')
  const { recordTextSize, setRecordTextSize } = useSettingStore()

  const handleSizeChange = (value: string) => {
    setRecordTextSize(value)
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Bookmark className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('recordTextSize.title')}</ItemTitle>
        <ItemDescription>{t('recordTextSize.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Select value={recordTextSize} onValueChange={handleSizeChange}>
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
