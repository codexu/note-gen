import { getCurrent, WebviewWindow } from '@tauri-apps/api/window';
import { invoke } from "@tauri-apps/api/tauri";
import { isRegistered, registerAll } from '@tauri-apps/api/globalShortcut';
import storage from 'store'
import { v4 as uuidv4 } from 'uuid';
import { clone } from 'lodash'
import { storeToRefs } from "pinia";
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';
import { db } from '../db.ts';
import useMarkStore, { defaultCreatingStatus } from '../stores/marks.ts';
import useTabStore from '../stores/tab.ts';
import { nextTick } from 'vue';
import takeDescription from './takeDescription.ts'

let result = clone(defaultCreatingStatus)

export async function screenshot() {
  result = clone(defaultCreatingStatus)
  
  const currentWindow = getCurrent()
  await currentWindow.hide();

  const id = uuidv4()
  const tabId = storage.get('currentTab')

  result.id = id
  result.tabId = tabId

  setTimeout(async () => {
    const path = await invoke<string>("screenshot_path");

    // 创建窗口
    const width = storage.get('webviewHeight') || undefined
    const height = storage.get('webviewHeight') || undefined
    new WebviewWindow('screenshotWindow', {
      url: `#/screenshot?path=${path}&id=${id}`,
      alwaysOnTop: true,
      decorations: false,
      focus: true,
      width,
      height,
      maximized: true,
      resizable: false,
      titleBarStyle: 'overlay',
      visible: true,
    })
  }, 100);
}

// webview 截图完成
export async function screenshotEnd(event: any) {
  const markStore = useMarkStore()
  const { creatingList } = storeToRefs(markStore)
  const { id, path } = event.payload
  result.path = path
  await nextTick();
  creatingList.value.unshift(clone(result))
  setTimeout(() => {
    analysisScreenshot(id, path);
  }, 1000);
}

// 分析截图
async function analysisScreenshot (id: string, path: string) {
  const markStore = useMarkStore()

  result.screenshotProgress = '识别文字'
  markStore.updateStatus(clone(result))
  await notificationScreenshot()
      
  // 文字识别
  const content = await invoke<string>("lt_ocr", { path });

  // 分析关键词
  result.screenshotProgress = '分析关键词'
  markStore.updateStatus(clone(result))
  const keywords = await invoke("cut_words", {
    str: content
  }) as string[]
  result.keywords = keywords

  // 分析内容，提取描述
  result.screenshotProgress = '分析内容'
  markStore.updateStatus(clone(result))
  const description = await takeDescription(content)
  result.description = description

  // 保存
  const currentTab = storage.get('currentTab')
  result.screenshotProgress = '保存'
  markStore.updateStatus(clone(result))
  await db.marks.add({
    imgPath: path,
    type: 'screenshot',
    status: true,
    content,
    description,
    tab: currentTab,
    keywords,
    deleted: false,
    createdAt: new Date().getTime()
  })
  markStore.complete(id)

  const tabStore = useTabStore()
  await tabStore.queryTabs()

  const tabId = storage.get('currentTab')
  await markStore.getMarks(tabId)
}

// 截图完成通知
async function notificationScreenshot() {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }
  if (permissionGranted) {
    sendNotification({ title: 'NoteGen', body: '截图成功' });
  }
}

export async function registerGlobalShortcut() {
  const registered = await isRegistered('Option+C');
  if (!registered) {
    await registerAll(['Option+C', 'Alt+C'], screenshot);
  }
}