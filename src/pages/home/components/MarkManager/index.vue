<template>
  <div class="h-12 flex justify-between items-center px-2 bg-gray-50 border-e-thin border-b-thin">
    <div>
      <v-btn size="small" variant="text" icon="mdi-vector-square-plus" v-tooltip="'截图记录'" @click="screenshot"></v-btn>
      <MarkText />
      <MarkImage />
    </div>
  </div>
  <div v-if="marks?.length || creatingList.length" class="list-mark story-scroll border-e-thin" v-viewer>
    <div class="flex justify-between px-2 pt-3 items-end">
      <p class="text-md font-bold text-gray-700">Marks</p>
      <span class="text-xs text-gray-400">{{ statusTotoal }} / {{ total }}</span>
    </div>
    <MarkCreative />
    <div v-for="item in marks" :key="item.id">
      <v-card :loading="loading" class="m-2" :variant="item.status ? 'elevated' : 'plain'">
        <template v-slot:loader="{ isActive }">
          <v-progress-linear
            :active="isActive"
            color="deep-purple"
            height="4"
            indeterminate
          ></v-progress-linear>
        </template>
        <div class="flex">
          <div class="overflow-hidden cursor-pointer h-28 w-28 flex justify-center items-center bg-gray-100">
            <v-img
              v-if="item.type !== 'text'"
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
            <v-dialog v-if="item.type === 'text'" max-width="800">
              <template v-slot:activator="{ props: activatorProps }">
                <v-icon v-bind="activatorProps" class="scale-150 h-full w-full">mdi-format-text</v-icon>
              </template>
              <template v-slot:default="{ isActive }">
                <v-card title="内容">
                  <v-card-text>
                    <p v-html="item.content" class="whitespace-pre-wrap text-gray-600" />
                  </v-card-text>
                  <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                      text="关闭"
                      @click="isActive.value = false"
                    ></v-btn>
                  </v-card-actions>
                </v-card>
              </template>
            </v-dialog>
          </div>
          <div class="flex-1 px-2 overflow-hidden">
            <div class="flex items-center justify-between mt-1">
              <div class="!py-0">
                <v-chip
                  label
                  variant="flat"
                  size="x-small"
                  v-for="keyword in item.keywords" :key="keyword"
                  :color="item.type === 'image' ? 'primary' : 'default'"
                  class="mr-1"
                >
                  {{ keyword }}
                </v-chip>
              </div>
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
  <Empty v-else-if="!creatingList.length" />
</template>

<script lang="ts" setup>
import { computed, watch} from 'vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'
import { db, Tab, type Mark } from '../../../../db.ts'
import MarkCreative from "./MarkCreative.vue";
import useTabStore from "../../../../stores/tab.ts"
import useMarkStore from '../../../../stores/marks.ts';
import { storeToRefs } from 'pinia';
import { screenshot } from '../../../../utils/screenshot.ts';
import Empty from './Empty.vue';
import emitter from '../../../../emitter.ts';
import MarkText from './MarkText.vue';
import MarkImage from './MarkImage.vue';

dayjs.locale(zh)
dayjs.extend(relativeTime)

const tabStore = useTabStore()
const markStore = useMarkStore()

const { creatingList } = storeToRefs(markStore)

const { checked, tabs } = storeToRefs(tabStore)

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
    await tabStore.queryTabs()
    if (marks.value.length === 0) {
      await db.notes.where({ tab: checked.value }).delete()
      emitter.emit('reloadNote')
    }
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