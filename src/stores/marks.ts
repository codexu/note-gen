import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { db, Mark } from "../db";
import { convertFileSrc } from "@tauri-apps/api/tauri";

export default defineStore('markStore', () => {
  const loading = ref(false)
  const marks = ref<Mark[]>([])

  async function getMarks(tabId: number) {
    loading.value = true
    const res = await db.marks.where({ tab: tabId }).toArray()
    marks.value = res.map(mark => ({
      ...mark,
      imgPath: convertFileSrc(mark.imgPath)
    })).reverse()
    loading.value = false
  }

  async function deleteMark(mark: Mark) {
    const index = marks.value.findIndex(item => item.id == mark.id)
    marks.value.splice(index, 1)
    await db.marks.delete(mark.id)
  }

  const enabledMarks = computed(() => {
    return marks.value.filter(mark => mark.status)
  })

  return {
    loading,
    marks,
    enabledMarks,
    getMarks,
    deleteMark,
  }
})