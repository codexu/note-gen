<template>
  <v-row v-if="marks?.length && !loading">
    <ScreenshotStatus />
    <v-col v-for="(item, index) in marks" :key="item.id" cols="12" xs="12" sm="12" md="6" lg="4" xl="3" xxl="1">
      <v-card>
        <div class="overflow-hidden">
          <v-img
            @click="showImageViewer(index)"
            :aspect-ratio="2"
            class="h-full cursor-pointer hover:scale-125 duration-1000 transition-transform"
            :lazy-src="item.imgPath"
            :src="item.imgPath"
            cover
          >
          </v-img>
          <v-checkbox
            class="absolute top-0 right-2"
            v-model="item.status"
            color="primary"
            @click="changeStatus(item)"
          ></v-checkbox>
        </div>
        <v-card-text>
          <v-chip-group>
            <v-chip size="small" v-for="keyword in item.keywords" :key="keyword">{{ keyword }}</v-chip>
          </v-chip-group>
          <!-- 最多3行文字 -->
          <p class="text-sm leading-6 mt-2 h-12 line-clamp-2">{{ item.description }}</p>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions class="flex justify-between">
          <div>
            <!-- 转移 -->
            <v-menu>
              <template v-slot:activator="{props}">
                <v-btn
                  size="small"
                  color="primary"
                  :disabled="tags.length === 0"
                  icon="mdi-swap-horizontal"
                  v-bind="props"
                ></v-btn>
              </template>
              <v-list>
                <v-list-item
                  v-for="(tag, index) in tags"
                  :key="index"
                  :value="index"
                >
                  <v-list-item-title @click="changeTag(item, tag)">{{ tag.name }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
            <!-- 删除 -->
            <v-btn size="small" color="error" @click="deleteMark(item)" icon="mdi-delete"></v-btn>
          </div>
          <!-- 时间 -->
          <span class="mb-0 text-sm text-gray-400 pr-2">{{ timeAgo(item.createdAt) }}</span>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
  <!-- 暂无记录 -->
  <div v-else-if="!store.screenshotList.length && !loading" class="w-full empty-wrap flex justify-center items-center">
    <v-empty-state
      headline="暂无记录"
      :title="`${currentTagName}标签中还没有任何记录`"
      text="赶快去截图生成一条 Mark 吧！"
    >
      <template v-slot:media>
        <v-icon icon="mdi-information-outline" class="mb-2"></v-icon>
      </template>
    </v-empty-state>
  </div>
  <div v-else class="h-48 w-80 mx-auto">
    <v-progress-linear indeterminate></v-progress-linear>
  </div>
  <!-- 图片预览 -->
  <ImageViewer v-if="marks && marks[imageViewerMarkIndex]" :src="marks[imageViewerMarkIndex].imgPath" v-model:visible="isShowImageViewer" />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref} from 'vue';
import { useStorage } from '@vueuse/core';
import { db, Tag, type Mark } from '../../../db.ts'
import storage from 'store'
import emitter from '../../../emitter.ts'
import { readBinaryFile } from '@tauri-apps/api/fs'
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'
import { Empty } from 'ant-design-vue';
import ScreenshotStatus from "./ScreenshotStatus.vue";
import ImageViewer from '../../../components/ImageViewer.vue';

import useStore from '../../../store.ts'

const store = useStore()

const loading = ref(false)

dayjs.locale(zh)
dayjs.extend(relativeTime)

const marks = ref<Mark[]>()
const currentTag = useStorage('currentTag', storage.get('currentTag'))

async function getMarks() {
  loading.value = true
  const result = await db.marks.where({ tag: currentTag.value }).toArray()
  marks.value = await Promise.all(result.map(async (mark) => {
    let imgPath = ''
    try {
      const imgFile = await readBinaryFile(mark.imgPath);
      imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));
    } catch (error) {
      imgPath = Empty.PRESENTED_IMAGE_SIMPLE;
    }
    return {
      ...mark,
      imgPath: imgPath
    }
  }).reverse())
  loading.value = false
}

// 获取所有标签
const allTags = ref<Tag[]>([])
const tags = ref<Tag[]>([])
async function queryTags() {
  const res = await db.tags.toArray()
  allTags.value = res
  tags.value = res.filter(item => item.id !== currentTag.value)
}

const currentTagName = computed(() => {
  return allTags.value.find(item => item.id === currentTag.value)?.name
})

emitter.on('refresh', listenRefresh)

async function listenRefresh() {
  await queryTags()
  await getMarks()
}

onMounted(async () => {
  await queryTags()
  await listenRefresh()
})

// 修改 mark tag
async function changeTag(mark: Mark, tag: Tag) {
  await db.marks.update(mark.id, { tag: tag.id })
  emitter.emit('refresh')
}

// 修改 mark status
async function changeStatus(mark: Mark) {
  console.log(mark);
  await db.marks.update(mark.id, { status: !mark.status })
  emitter.emit('refresh')
}

// 删除记录
async function deleteMark(mark: Mark) {
  await db.marks.delete(mark.id)
  emitter.emit('refresh')
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
</script>

<style lang="scss">
.empty-wrap {
  height: calc(100vh - 180px);
  overflow: hidden;
}
</style>