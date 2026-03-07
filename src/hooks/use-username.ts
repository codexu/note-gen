import { useMemo } from "react"
import useSyncStore from "@/stores/sync"
import useSettingStore from "@/stores/setting"
import { Store } from "@tauri-apps/plugin-store"

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
      case 's3':
        // S3 使用 bucket 名称作为标识
        return null // 异步获取，在组件中处理
    }
  }, [userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo, primaryBackupMethod])

  return username
}

// 单独导出一个异步函数用于 S3
export async function getS3BucketName(): Promise<string | null> {
  const store = await Store.load('store.json')
  const s3Config = await store.get<{ bucket: string }>('s3SyncConfig')
  return s3Config?.bucket || null
}

export default useUsername
