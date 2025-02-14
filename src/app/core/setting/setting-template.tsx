import useSettingStore, { GenTemplate, GenTemplateRange } from "@/stores/setting";
import { SettingRow, SettingType } from "./setting-base";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirm } from '@tauri-apps/plugin-dialog';
import { _t } from '@/locales/index';

export function SettingTemplate({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { templateList, setTemplateList } = useSettingStore()
  const [ isClient, setIsClient ] = useState(false);

  function changeHandler(current: GenTemplate, key: keyof GenTemplate, value: any) {
    console.log(current, key, value);
    setTemplateList(templateList.map(item => {
      if (item.id === current.id) {
        return {...item, [key]: value}
      }
      return item
    }))
  }

  function createTemplateHandler() {
    setTemplateList([...templateList, {
      id: `${templateList.length + 1}`,
      status: true,
      title: _t('setting_template_title'),
      content: '',
      range: GenTemplateRange.All,
    }])
  }

  function deleteTemplateHandler(id: string) {
    confirm(`${_t('setting_template_delete')}?`).then(async (res) => {
      if (res) {
        setTemplateList(templateList.filter(item => item.id !== id))
      }
    })
  }

  useEffect(() => {
    setIsClient(true);
  }, [templateList])

  if (!isClient) {
    return null; // or a loading state
  }

  return (
    <SettingType id={id} icon={icon} title={_t('template_settings_title')}>
      <SettingRow>
        <Table>
          <TableCaption>
            <Button onClick={createTemplateHandler} variant={"link"}>{_t('setting_template_add')}</Button>
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px] text-center">{_t('setting_template_status')}</TableHead>
              <TableHead className="w-[100px] pl-3">{_t('setting_template_name')}</TableHead>
              <TableHead className="pl-3">{_t('setting_template_content')}</TableHead>
              <TableHead className="w-[120px]">{_t('setting_template_range')}</TableHead>
              <TableHead className="text-center w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {
              templateList.map((item) => {
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Switch
                        className="transform scale-75 translate-y-0.5"
                        disabled={item.id === '0'}
                        checked={item.status}
                        onCheckedChange={(checked) => changeHandler(item, 'status', checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="setting-input"
                        defaultValue={item.title}
                        onBlur={(e) => changeHandler(item, 'title', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={3}
                        className="setting-input"
                        defaultValue={item.content}
                        onBlur={(e) => changeHandler(item, 'content', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                    <Select onValueChange={(value) => changeHandler(item, 'range', value)} defaultValue={item.range}>
                      <SelectTrigger className="w-[120px] setting-select">
                        <SelectValue placeholder={_t('setting_template_range')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {
                            Object.values(GenTemplateRange).map((value) => {
                              return <SelectItem key={value} value={value}>{value}</SelectItem>
                            })
                          }
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        disabled={item.id === '0'}
                        variant={"ghost"}
                        size={"icon"}
                        className="text-red-500"
                        onClick={() => deleteTemplateHandler(item.id)}
                      ><XIcon /></Button>
                    </TableCell>
                  </TableRow>
                )
              })
            }
          </TableBody>
        </Table>
      </SettingRow>
    </SettingType>
  )
}
