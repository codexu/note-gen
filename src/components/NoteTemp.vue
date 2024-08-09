<template>
  <section class="w-full bg-white p-4 mb-2" v-for="item in remarks" :key="item.id">
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
            <a-button danger @click="deleteRemark(item)" :icon="h(DeleteOutlined)"></a-button>
          </a-space>
          <span class="mb-0 text-sm text-gray-400">{{ timeAgo(item.createdAt) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { onMounted, ref, h } from 'vue';
import { DeleteOutlined, SwapOutlined } from '@ant-design/icons-vue';
import { db, Tag, type Remark } from '../db.ts'
import store from 'store'
import emitter from '../emitter.ts'
import { readBinaryFile } from '@tauri-apps/api/fs'
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'

dayjs.locale(zh)
dayjs.extend(relativeTime)

const remarks = ref<Remark[]>()

async function getRemarks() {
  const currentTag = store.get('currentTag') as string;
  const result = await db.remarks.where({ tag: currentTag }).toArray()
  remarks.value = await Promise.all(result.map(async (remark) => {
    const imgFile = await readBinaryFile(remark.imgPath);
    const imgPath = URL.createObjectURL(new Blob([imgFile], { type: 'image/jpeg' }));
    return {
      ...remark,
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
  await getRemarks()
}

onMounted(async () => {
  await queryTags()
  await listenRefresh()
})

// 修改 remark tag
async function changeTag(remark: Remark, tag: Tag) {
  await db.remarks.update(remark.id, { tag: tag.name })
  emitter.emit('refresh')
}

// 删除记录
async function deleteRemark(remark: Remark) {
  await db.remarks.delete(remark.id)
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
</style>