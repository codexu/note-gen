import { Button } from "@/components/ui/button";
import useSettingStore from "@/stores/setting";

export default function PrimarySync() {
  const { primaryBackupMethod } = useSettingStore()
  return primaryBackupMethod ? 
  <Button variant={'ghost'} size={'sm'} className="outline-none hidden lg:block" disabled>
    {primaryBackupMethod.charAt(0).toUpperCase() + primaryBackupMethod.slice(1)}
  </Button> : null
}