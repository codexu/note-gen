import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { db, Mark } from "../db";
import { convertFileSrc } from "@tauri-apps/api/tauri";

export interface CreatingStatus {
  id: string
  tabId: number
  path: string
  keywords: string[]
  description: string;
  screenshotStatus: boolean
  screenshotProgress: string
}

export const defaultCreatingStatus: CreatingStatus = {
  id: '',
  tabId: 0,
  path: '',
  keywords: [],
  description: '',
  screenshotStatus: true,
  screenshotProgress: '截图',
}

export default defineStore('markStore', () => {
  const loading = ref(false)
  const marks = ref<Mark[]>([])
  
  const creatingList = ref<CreatingStatus[]>([])
  
  function updateStatus(data: CreatingStatus) {
    const item = creatingList.value.find(item => item.id === data.id)
    if (item) {
      item.path = data.path
      item.keywords = data.keywords
      item.description = data.description
      item.screenshotProgress = data.screenshotProgress
      item.screenshotStatus = data.screenshotStatus
    }
  }

  function complete(id: string) {
    const index = creatingList.value.findIndex(item => item.id === id)
    creatingList.value.splice(index, 1)
  }
  async function getMarks(tabId: number) {
    loading.value = true
    const res = await db.marks.where({ tab: tabId }).toArray()
    marks.value = res.map(mark => ({
      ...mark,
      imgPath: mark.type !== 'text' ? convertFileSrc(mark.imgPath) : ''
    })).filter(mark => !mark.deleted).reverse()
    loading.value = false
  }

  async function deleteMark(mark: Mark) {
    const index = marks.value.findIndex(item => item.id == mark.id)
    marks.value.splice(index, 1)
    await db.marks.update(mark.id, { deleted: true, deletedAt: Date.now() })
  }

  const enabledMarks = computed(() => {
    return marks.value.filter(mark => mark.status)
  })

  return {
    creatingList,
    updateStatus,
    complete,
    loading,
    marks,
    enabledMarks,
    getMarks,
    deleteMark,
  }
})