import { isMobileDevice } from './check'
import { useSidebarStore } from '@/stores/sidebar'

/**
 * 记录完成后的导航处理
 * 桌面端：切换到记录 tab
 * 移动端：跳转到记录页面
 */
export function handleRecordComplete(router?: any) {
  const isMobile = isMobileDevice()
  
  if (isMobile) {
    // 移动端：跳转到记录页面
    if (router) {
      router.push('/mobile/record')
    } else if (typeof window !== 'undefined') {
      window.location.href = '/mobile/record'
    }
  } else {
    // 桌面端：切换到记录 tab
    const { setLeftSidebarTab } = useSidebarStore.getState()
    setLeftSidebarTab('notes')
  }
}
