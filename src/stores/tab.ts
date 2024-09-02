import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db, Tab } from '../db'
import { useStorage } from '@vueuse/core'

export const DEFAULT_TAB_NAME = '灵感'

interface Tabs extends Tab {
  total: number
}

export default defineStore('tabStore', () => {
  // 当前选中的标签
  const checked = useStorage('currentTab', 0)
  const tabs = ref<Tabs[]>([])

  // 查询 tabs
  async function queryTabs() {
    const res = await db.tabs.toArray()
    tabs.value = res.map(tab => ({ ...tab, total: 0 }))
    // 查询数量
    for (let index = 0; index < tabs.value.length; index++) {
      const tab = tabs.value[index];
      const total = await db.marks.where({ tab: tab.id }).count()
      tabs.value[index].total = total
    }
  }

  // 创建默认标签
  async function createDefaultTab() {
    const hasTab = await db.tabs.where({ name: DEFAULT_TAB_NAME }).count()
    if (!hasTab) {
      const defaultTabId = await db.tabs.add({
        name: DEFAULT_TAB_NAME,
        total: 0,
        createdAt: new Date().getTime()
      })
      checked.value = defaultTabId
    }
  }

  // 创建新标签
  async function createTab(name: string) {
    const tabId = await db.tabs.add({
      name,
      createdAt: new Date().getTime()
    })
    .catch(() => {
      return null
    })
    await queryTabs()
    checked.value = tabId
    return tabId
  }

  async function updateTabName(id: number) {
    const name = tabs.value.find(t => t.id === id)?.name
    await db.tabs.update(id, { name })
    await queryTabs()
  }

  // 删除标签
  async function deleteTab(tab: Tab, event: Event) {
    event.stopPropagation()
    await db.tabs.delete(tab.id)
    const index = tabs.value.findIndex(item => item.id == tab.id)
    tabs.value.splice(index, 1)
    if (checked.value === tab.id) {
      checked.value = tabs.value[index - 1].id
    }
  }

  const checkedTabName = computed(() => {
    return tabs.value.find(item => item.id === checked.value)?.name
  })

  return {
    checked,
    tabs,
    queryTabs,
    createDefaultTab,
    createTab,
    updateTabName,
    deleteTab,
    checkedTabName
  }
})