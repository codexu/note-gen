import { getCurrent, WebviewWindow } from '@tauri-apps/api/window';
import { invoke } from "@tauri-apps/api/tauri";
import { isRegistered, registerAll } from '@tauri-apps/api/globalShortcut';
import storage from 'store'
import { v4 as uuidv4 } from 'uuid';
import { clone } from 'lodash'
import useScreenshotStore, { ScreenshotListStatus } from '../stores/screenshot.ts'
import { storeToRefs } from "pinia";
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/api/notification';
import { db } from '../db.ts';
import { Data, getCompletions } from '../api/completions.ts';
import useMarkStore from '../stores/marks.ts';
import useTabStore from '../stores/tab.ts';

const result: ScreenshotListStatus = {
  id: '',
  tabId: 0,
  path: '',
  keywords: [],
  description: '',
  screenshotStatus: true,
  screenshotProgress: '截图',
}

export async function screenshot() {
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
  const screenshotStore = useScreenshotStore()
  const { screenshotList } = storeToRefs(screenshotStore)
  const { id, path } = event.payload
  result.path = path
  screenshotList.value.unshift(clone(result))
  setTimeout(() => {
    analysisScreenshot(id, path);
  }, 1000);
}

// 分析截图
async function analysisScreenshot (id: string, path: string) {
  const screenshotStore = useScreenshotStore()

  result.screenshotProgress = '识别文字'
  screenshotStore.updateStatus(clone(result))
  await notificationScreenshot()
      
  // 文字识别
  const content = await invoke<string>("lt_ocr", { path });

  // 分析关键词
  result.screenshotProgress = '分析关键词'
  screenshotStore.updateStatus(clone(result))
  const keywords = await invoke("cut_words", {
    str: content
  }) as string[]
  result.keywords = keywords

  // 分析内容，提取描述
  result.screenshotProgress = '分析内容'
  screenshotStore.updateStatus(clone(result))
  const description = await takeDescription(content)
  result.description = description

  // 保存
  const currentTab = storage.get('currentTab')
  result.screenshotProgress = '保存'
  screenshotStore.updateStatus(clone(result))
  await db.marks.add({
    imgPath: path,
    status: true,
    content,
    description,
    tab: currentTab,
    keywords,
    createdAt: new Date().getTime()
  })
  screenshotStore.complete(id)

  const tabStore = useTabStore()
  await tabStore.queryTabs()

  const markStore = useMarkStore()
  const tabId = storage.get('currentTab')
  await markStore.getMarks(tabId)
}

// 提取识别文字里的重要内容
async function takeDescription(content: string) {
  const request_content = `
    以下是截图后使用 OCR 识别出的文字，该截图是整个屏幕的截图，识别后的内容为：${content}。请返回一句此截图内容的核心内容描述，长度不要超过50字。
  `
  const data: Data = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: request_content,
      },
    ]
  }
  const res = await getCompletions(data);
  const result = res.data.choices[0].message.content
  return result
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
  console.log(registered);
  if (!registered) {
    await registerAll(['Option+C', 'Alt+C'], screenshot);
  }
}