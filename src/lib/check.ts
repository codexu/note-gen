import { platform } from "@tauri-apps/plugin-os";

// 异步检查是否为移动设备的函数
export async function isMobileDeviceAsync() {
  try {
    const platformName = await platform();
    return platformName === 'android' || platformName === 'ios';
  } catch (error) {
    console.error('Error detecting platform:', error);
    return false;
  }
}

// 缓存移动设备检测结果
let _isMobile: boolean | null = null;

// 同步版本的设备检测函数
// 在客户端使用时，首次调用会根据屏幕宽度返回临时结果
// 然后异步获取真实平台信息并缓存结果
export function isMobileDevice() {
  // 如果已经有缓存结果，直接返回
  if (_isMobile !== null) return _isMobile;
  
  // 客户端环境下异步获取真实结果并缓存
  if (typeof window !== 'undefined') {
    isMobileDeviceAsync().then(mobile => {
      _isMobile = mobile;
    }).catch(() => {
      // 如果获取失败，使用屏幕宽度作为备选判断
      _isMobile = window.innerWidth < 768;
    });
    
    // 临时使用屏幕宽度判断
    return window.innerWidth < 768;
  }
  
  // 服务器渲染时默认返回 false
  return false;
}