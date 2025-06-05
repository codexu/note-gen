import { Button } from "@/components/ui/button";
import useSettingStore from "@/stores/setting";

export default function PrimarySync() {
  const { primaryBackupMethod, accessToken, giteeAccessToken } = useSettingStore()
  return primaryBackupMethod && primaryBackupMethod === 'github' && accessToken || primaryBackupMethod === 'gitee' && giteeAccessToken ? <Button variant={'ghost'} size={'sm'} className="outline-none" disabled>
    {primaryBackupMethod === 'github' ? 'GitHub' : 'Gitee'}
  </Button> : null
}