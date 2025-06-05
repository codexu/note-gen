import { Button } from "@/components/ui/button";
import { SettingRow } from "../components/setting-base";
import { HardDriveDownload, HardDriveUpload } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/hooks/use-toast";
import { BaseDirectory, copyFile } from "@tauri-apps/plugin-fs";
import { relaunch } from "@tauri-apps/plugin-process";

export default function SetConfig() {
    const { toast } = useToast()
    async function handleImport() {
      const file = await open({
        title: '导入配置文件',
      })
      if (file) {
        await copyFile(file, 'store.json', { toPathBaseDir: BaseDirectory.AppData })
        toast({ title: '导入成功' })
        relaunch()
      }
    }
    async function handleExport() {
      const file = await save({
        title: '导出配置文件',
        defaultPath: 'store.json',
      })
      if (file) {
        await copyFile('store.json', file, { fromPathBaseDir: BaseDirectory.AppData })
        toast({ title: '导出成功' })
      }
    }
    return (
    <SettingRow border>
      <span>配置文件导入与导出，导入配置文件将覆盖当前配置，并且重启后生效。</span>
      <div className="flex gap-2">
        <Button onClick={handleImport}><HardDriveDownload />导入</Button>
        <Button onClick={handleExport}><HardDriveUpload />导出</Button>
      </div>
    </SettingRow>
  )
}