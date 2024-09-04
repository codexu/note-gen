<template>
  <div class="h-12 flex justify-between items-center px-2 bg-gray-50 border-e-thin border-b-thin">
    <div>
      <v-btn size="small" variant="text" icon="mdi-vector-square-plus" v-tooltip="'截图记录'" @click="screenshot"></v-btn>
      <v-btn size="small" variant="text" icon="mdi-clipboard-text-multiple-outline" v-tooltip="'文字记录'"></v-btn>
      <v-btn size="small" variant="text" icon="mdi-image-plus-outline" v-tooltip="'图片标记'"></v-btn>
    </div>
  </div>
  <div v-if="marks?.length" class="list-mark story-scroll border-e-thin">
    <div class="flex justify-between px-2 pt-3 items-end">
      <p class="text-md font-bold text-gray-700">Marks</p>
      <span class="text-xs text-gray-400">{{ statusTotoal }} / {{ total }}</span>
    </div>
    <MarkCreative />
    <div v-for="(item, index) in marks" :key="item.id">
      <v-card :loading="loading" class="m-2">
        <template v-slot:loader="{ isActive }">
          <v-progress-linear
            :active="isActive"
            color="deep-purple"
            height="4"
            indeterminate
          ></v-progress-linear>
        </template>
        <div class="flex">
          <div class="overflow-hidden h-28 w-28 bg-gray-400">
            <v-img
              @click="showImageViewer(index)"
              class="h-28 w-28 cursor-zoom-in hover:scale-105 duration-1000 transition-transform"
              :src="item.imgPath"
              cover
            >
              <template v-slot:placeholder>
                <div class="d-flex align-center justify-center fill-height bg-gray-400">
                  <v-progress-circular
                    color="grey-lighten-4"
                    indeterminate
                  ></v-progress-circular>
                </div>
              </template>
            </v-img>
          </div>
          <div class="flex-1 px-2 overflow-hidden">
            <div class="flex items-center justify-between">
              <v-chip-group class="!py-0">
                <v-chip label variant="flat" size="x-small" v-for="keyword in item.keywords" :key="keyword">{{ keyword }}</v-chip>
              </v-chip-group>
              <v-checkbox class="flex items-center h-6 scale-75 translate-x-3" v-model="item.status" @click="changeStatus(item)"></v-checkbox>
            </div>
            <!-- 最多3行文字 -->
            <p class="text-xs leading-5 my-1 line-clamp-2">{{ item.description }}</p>
            <div class="flex justify-between items-center">
              <div class="flex items-center">
                <!-- 转移 -->
                <v-menu>
                  <template v-slot:activator="{props}">
                    <v-btn
                      size="x-small"
                      variant="plain"
                      :disabled="tabs.length === 0"
                      icon="mdi-swap-horizontal"
                      v-bind="props"
                    ></v-btn>
                  </template>
                  <v-list density="comfortable" class="scale-75 translate-x-[-45px] translate-y-[-14px]">
                    <v-list-subheader>选择要转移到的标签</v-list-subheader>
                    <v-list-item
                      v-for="(tab, index) in tabs"
                      :key="index"
                      :value="index"
                      :disabled="tab.id === checked"
                      @click="transferMark(item, tab)"
                    >
                      <template v-slot:append>
                        <v-badge inline :content="tab.total"></v-badge>
                      </template>
                      <v-list-item-title class="min-w-48">
                        {{ tab.name }}
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <!-- 删除 -->
                <v-btn size="x-small" variant="plain" color="error" @click="handleDelete(item)" icon="mdi-delete"></v-btn>
              </div>
              <!-- 时间 -->
              <span class="mb-0 text-xs text-gray-400">{{ timeAgo(item.createdAt) }}</span>
            </div>
          </div>
        </div>
      </v-card>
    </div>
  </div>
  <!-- 暂无记录 -->
  <div v-else-if="!screenshotStore.screenshotList.length" class="w-full h-full empty-wrap flex justify-center items-center border-e-thin">
    <v-empty-state
      headline="暂无记录"
      text="赶快去生成一条 Mark 吧！"
    >
      <template v-slot:media>
        <v-icon icon="mdi-information-outline" class="mb-2"></v-icon>
      </template>
    </v-empty-state>
  </div>
  <!-- 图片预览 -->
  <ImageViewer
    v-if="marks && marks[imageViewerMarkIndex]"
    :src="marks[imageViewerMarkIndex].imgPath"
    v-model:visible="isShowImageViewer"
  />
</template>

<script lang="ts" setup>
import { computed, ref, watch} from 'vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'
import { db, Tab, type Mark } from '../../../db.ts'
import ImageViewer from '../../../components/ImageViewer.vue';
import MarkCreative from "./MarkCreative.vue";
import useTabStore from "../../../stores/tab.ts"
import useMarkStore from '../../../stores/marks.ts';
import useScreenshotStore from '../../../stores/screenshot.ts'
import { storeToRefs } from 'pinia';
import { screenshot } from '../../../utils/screenshot.ts';

dayjs.locale(zh)
dayjs.extend(relativeTime)

const tabStore = useTabStore()
const markStore = useMarkStore()
const screenshotStore = useScreenshotStore()

const { checked, tabs, checkedTabName } = storeToRefs(tabStore)

const { marks, loading } = storeToRefs(markStore)

watch(checked, async () => {
  await markStore.getMarks(checked.value)
}, { immediate: true })

// 修改 mark tab 
async function transferMark(mark: Mark, tab: Tab) {
  const res = await db.marks.update(mark.id, { tab: tab.id })
  // 移除 mark，并修改标签总数
  if (res) {
    const index = marks.value.findIndex(item => item.id === mark.id)
    marks.value.splice(index, 1)
    tabStore.queryTabs()
  }
}

// 修改 mark status
async function changeStatus(mark: Mark) {
  await db.marks.update(mark.id, { status: !mark.status })
}

async function handleDelete(mark: Mark) {
  await markStore.deleteMark(mark)
  await tabStore.queryTabs()
}

// 计算时间以前
function timeAgo(time: number) {
  return dayjs(time).fromNow()
}

// 图片预览
const isShowImageViewer = ref(false)
const imageViewerMarkIndex = ref(0)

function showImageViewer(index: number) {
  isShowImageViewer.value = true
  imageViewerMarkIndex.value = index
}

// 计算数量
const total = computed(() => {
  return marks.value.length
})
const statusTotoal = computed(() => {
  return marks.value.filter(mark => mark.status).length
})
</script>

<style lang="scss" scoped>
.list-mark{
  height: calc(100vh - 48px);
}
</style>