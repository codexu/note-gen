import { platform } from "@tauri-apps/plugin-os";

// 异步检查是否为移动设备的函数
export function isMobileDevice() {
  try {
    const platformName = platform();
    return platformName === 'android' || platformName === 'ios';
  } catch (error) {
    console.error('Error detecting platform:', error);
    return false;
  }
}
