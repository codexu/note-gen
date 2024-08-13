import { defineStore } from 'pinia'
import { ref } from 'vue'

interface ScreenshotListStatus {
  id: string
  screenshotStatus: boolean
  screenshotProgress: string
}

export default defineStore('store', () => {
  const screenshotList = ref<ScreenshotListStatus[]>([])

  function updateStatus(data: ScreenshotListStatus) {
    const item = screenshotList.value.find(item => item.id === data.id)
    if (item) {
      item.screenshotProgress = data.screenshotProgress
      item.screenshotStatus = data.screenshotStatus
    }
  }

  function complete(id: string) {
    screenshotList.value = screenshotList.value.filter(item => item.id !== id)
  }

  return {
    screenshotList,
    updateStatus,
    complete
  }
})