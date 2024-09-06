<template>
  <v-data-table
    density="compact"
    fixed-header
    :height="height"
    v-model:page="page"
    :headers="headers"
    :items="desserts"
    :items-per-page="itemsPerPage"
  >
    <template v-slot:item.index="{ index }">
      {{ index + 1 + (page - 1) * itemsPerPage }}
    </template>
    <template v-slot:item.imgPath="{ value }">
      <v-img class="w-6 h-6" cover :src="convertFileSrc(value)" />
    </template>
    <template v-slot:item.keywords="{ value }">
      <v-chip
        v-for="(item, index) in value" :key="index"
        class="mr-1"
        size="x-small"
      >
        {{ item }}
      </v-chip>
    </template>
    <template v-slot:item.content="{ value }">
      <v-icon v-tooltip="value" class="ml-1 cursor-pointer" color="primary">mdi-text-search</v-icon>
    </template>
    <template v-slot:item.description="{ value }">
      {{ value }}
    </template>
    <template v-slot:item.deletedAt="{ value }">
      {{ dayjs(value).fromNow() }}
    </template>
    <template v-slot:item.actions="{ item }">
      <v-btn icon="mdi-recycle-variant" variant="text" color="error" size="small" v-tooltip="'还原'" @click="recycle(item)"></v-btn>
    </template>
  </v-data-table>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { db, Mark } from '../../../../db';
import { convertFileSrc } from "@tauri-apps/api/tauri";
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh-cn'

dayjs.locale(zh)
dayjs.extend(relativeTime)

const page = ref(1)
const pageCount = ref(0)
const itemsPerPage = ref(10)
const headers = [
  { title: '索引', key: 'index', sortable: false },
  { title: '记录', key: 'imgPath', sortable: false },
  { title: '关键词', key: 'keywords', sortable: false },
  { title: '描述', key: 'description', sortable: false },
  { title: '内容', key: 'content', sortable: false },
  { title: '来源于', key: 'tabName' },
  { title: '删除于', key: 'deletedAt' },
  { title: '操作', key: 'actions', sortable: false },
]

interface DeletedMark extends Mark {
  tabName: string
}

const desserts = ref<DeletedMark[]>([])

// 获取 marks
async function getDeletedMarks() {
  desserts.value = []
  const res = (await db.marks.filter(item => item.deleted).sortBy('deletedAt')).reverse()
  res.forEach(async(item) => {
    const tabName = await db.tabs.get(item.tab).then(tab => tab?.name) || ''
    desserts.value.push({ tabName, ...item })
  })
  pageCount.value = Math.ceil(desserts.value.length / itemsPerPage.value)
}

const height = computed(() => {
  // 屏幕高度
  return window.innerHeight - 62
})

onMounted(() => {
  getDeletedMarks()
})

async function recycle(item: Mark) {
  await db.marks.update(item.id, { deleted: false, status: false })
  getDeletedMarks()
}
</script>

<style lang="scss" scoped>

</style>
