<template>
  <v-data-table
    density="compact"
    fixed-header
    show-select
    :height="height"
    v-model="selected"
    v-model:page="page"
    :headers="(headers as any)"
    :items="desserts"
    :items-per-page="itemsPerPage"
    :update:itemsPerPage="getDeletedMarks"
    items-per-page-text="每页记录数"
    v-viewer
  >
    <template v-slot:item.index="{ index }">
      {{ index + 1 + (page - 1) * itemsPerPage }}
    </template>
    <template v-slot:item.imgPath="{ value }">
      <v-img v-if="value" cover :src="convertFileSrc(value)" />
      <v-icon v-else>mdi-format-text</v-icon>
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
    <template v-slot:item.description="{ value }">
      {{ value }}
    </template>
    <template v-slot:item.deletedAt="{ value }">
      {{ dayjs(value).fromNow() }}
    </template>
    <template v-slot:item.actions="{ item }">
      <v-dialog max-width="800">
        <template v-slot:activator="{ props: activatorProps }">
          <v-icon v-bind="activatorProps" class="cursor-pointer" color="primary" v-tooltip="'内容'">mdi-text-search</v-icon>
        </template>
        <template v-slot:default="{ isActive }">
          <v-card title="内容">
            <v-card-text>
              <p class="whitespace-pre-wrap text-gray-600">{{ item.content }}</p>
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
      <v-btn icon="mdi-recycle-variant" variant="text" color="error" size="small" v-tooltip="'还原'" @click="recycle(item)"></v-btn>
    </template>
    <template v-slot:footer.prepend>
      <div class="flex-1 px-1">
        <v-btn
          :disabled="selected.length === 0"
          size="small"
          variant="text"
          icon="mdi-delete"
          color="error"
          @click="deleteSelected"
          v-tooltip="'产出选中项'"
        >
        </v-btn>
      </div>
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
const itemsPerPage = ref(100)
const selected = ref<number[]>([])
const headers = [
  { title: '索引', key: 'index', sortable: false, align: 'center', width: 80 },
  { title: '记录', key: 'imgPath', sortable: false, align: 'center', width: 64 },
  { title: '关键词', key: 'keywords', sortable: false },
  { title: '描述', key: 'description', sortable: false },
  { title: '来源于', key: 'tabName', width: 140 },
  { title: '删除于', key: 'deletedAt', width: 100 },
  { title: '操作', key: 'actions', sortable: false, align: 'center', width: 100 },
]

interface DeletedMark extends Mark {
  tabName: string
}

const desserts = ref<DeletedMark[]>([])

// 获取 marks
async function getDeletedMarks() {
  desserts.value = []
  const cache: DeletedMark[] = []
  const res = (await db.marks.filter(item => item.deleted).sortBy('deletedAt')).reverse()
  for (const element of res) {
    const tabName = await db.tabs.get(element.tab).then(tab => tab?.name) || ''
    cache.push({ tabName, ...element })
  }
  desserts.value = [...cache]
  pageCount.value = Math.ceil(desserts.value.length / itemsPerPage.value)
}

const height = computed(() => {
  // 屏幕高度
  return window.innerHeight - 62
})

async function deleteSelected() {
  await db.marks.bulkDelete(selected.value)
  selected.value = []
  getDeletedMarks()
}

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
