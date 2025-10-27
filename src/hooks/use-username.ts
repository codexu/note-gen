import { useMemo } from "react"
import useSyncStore from "@/stores/sync"
import useSettingStore from "@/stores/setting"

// 获取当前主要备份方式的用户名，以确保配置正确
function useUsername() {
  const { primaryBackupMethod } = useSettingStore()
  const { userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo } = useSyncStore()
  const username = useMemo(() => {
    switch (primaryBackupMethod) {
      case 'github':
        return userInfo?.login
      case 'gitee':
        return giteeUserInfo?.login
      case 'gitlab':
        return gitlabUserInfo?.name
      case 'gitea':
        return giteaUserInfo?.login
    }
  }, [userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo, primaryBackupMethod])

  return username
}

export default useUsername
