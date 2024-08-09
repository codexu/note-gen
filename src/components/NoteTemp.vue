<template>
  <template v-for="item in marks" :key="item.id" v-if="marks?.length">
    <a-badge-ribbon text="Mark">
      <section class="w-full bg-white p-4 mb-2" >
        <div class="flex w-full border-b border-gray-300">
          <div class="mr-4 h-40">
            <a-image :src="item.imgPath" />
          </div>
          <div class="w-full flex flex-col justify-between">
            <div>
              <a-tag v-for="(keyword, index) in item.keywords" :key="index">{{ keyword }}</a-tag>
              <p class="line-clamp-3 text-sm leading-6 mt-3 mb-3">{{ item.content }}</p>
            </div>
            <div class="flex justify-between items-end">
              <a-space>
                <a-dropdown>
                  <a-button :icon="h(SwapOutlined)"></a-button>
                  <template #overlay>
                    <a-menu>
                      <a-menu-item v-for="(tag, index) in tags" :key="index">
                        <a @click="changeTag(item, tag)">{{ tag.name }}</a>
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
                <a-button danger @click="deleteMark(item)" :icon="h(DeleteOutlined)"></a-button>
              </a-space>
              <span class="mb-0 text-sm text-gray-400">{{ timeAgo(item.createdAt) }}</span>
            </div>
          </div>
        </div>
      </section>
    </a-badge-ribbon>
  </template>
  <div v-else class="w-full empty-wrap flex justify-center items-center">
    <a-empty description="你还没有任何记录" />
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, h } from 'vue';
import { DeleteOutlined, SwapOutlined } from '@ant-design/icons-vue';
import { db, Tag, type Mark } from '../db.ts'
import store from 'store'
import emitter from '../emitter.ts'
import { readBinaryFile } from '@tauri-apps/api/fs'
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'

dayjs.locale(zh)
dayjs.extend(relativeTime)

const marks = ref<Mark[]>()

async function getMarks() {
  const currentTag = store.get('currentTag') as string;
  const result = await db.marks.where({ tag: currentTag }).toArray()
  marks.value = await Promise.all(result.map(async (mark) => {
    const imgFile = await readBinaryFile(mark.imgPath);
    const imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));
    return {
      ...mark,
      imgPath: imgPath
    }
  }))
}

// 获取所有标签
const tags = ref<Tag[]>([])
async function queryTags() {
  const res = await db.tags.toArray()
  tags.value = res
}

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
  await db.marks.update(mark.id, { tag: tag.name })
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
</script>

<style lang="scss">
.ant-image{
  height: 160px;
  width: 300px;
  .ant-image-img{
    height: 160px;
    width: 300px;
    object-fit: cover;
  }
}
.empty-wrap {
  height: calc(100vh - 120px);
  overflow: hidden;
}
</style>