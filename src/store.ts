import { defineStore } from 'pinia'

export default defineStore('store', {
  state: () => {
    return {
      screenshotStatus: false, //截图与分析状态
      screenshotProgress: '', //截图进度说明
    }
  },
})