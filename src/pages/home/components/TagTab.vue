<template>
  <div class="w-full flex items-center justify-between">
    <v-tabs
      class="flex-1"
      v-model="checked"
      align-tabs="title"
      show-arrows
      @update:model-value="segmentedChange"
    >
      <v-tab
        v-for="(tag, index) in tags"
        :key="tag.id"
        :value="tag.id"
      >
      {{ tag.name }}
      <v-icon
        v-if="tag.name !== DEFAULT_TAG_NAME && isEditing"
        @click="deleteTag(tag, $event)"
        class="ml-2"
        icon="mdi-close"
      ></v-icon>
      <v-badge
        v-else
        color="primary"
        :content="marksTotals[index]"
        inline
      ></v-badge>
      </v-tab>
    </v-tabs>
    <div class="flex pr-1">
      <TagAdd />
      <v-btn icon @click="handleEdit" v-tooltip="'编辑标签'">
        <v-icon v-if="!isEditing">mdi-cog-outline</v-icon>
        <v-icon v-else>mdi-cog-off-outline</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useStorage } from '@vueuse/core'
import TagAdd from './TagAdd.vue'
import emitter from '../../../emitter.ts'
import { db, type Tag } from '../../../db.ts';
import { nextTick, onMounted, ref } from 'vue';

const tags = ref<Tag[]>([])

// 查询 tags
async function queryTags() {
  const res = await db.tags.toArray()
  tags.value = res.map(item => {
    return {
      ...item,
      total: 0
    }
  })
}

const checked = useStorage('currentTag', 0)

async function segmentedChange() {
  await nextTick()
  emitter.emit('refresh')
}

// 创建默认标签
const DEFAULT_TAG_NAME = '灵感'
async function createDefaultTag() {
  const hasTag = await db.tags.where({ name: DEFAULT_TAG_NAME }).count()
  if (!hasTag) {
    const defaultTagId = await db.tags.add({
      name: DEFAULT_TAG_NAME,
      total: 0,
      createdAt: new Date().getTime()
    })
    checked.value = defaultTagId
  }
}

emitter.on('refresh', async () => {
  await queryTags()
  await getTagTotal()
})

onMounted(async () => {
  await createDefaultTag();
  await queryTags();
  await getTagTotal()
})

const isEditing = ref(false)
function handleEdit() {
  isEditing.value = !isEditing.value
}

async function deleteTag(tag: Tag, event: Event) {
  event.stopPropagation()
  await db.tags.delete(tag.id)
  await queryTags()
  if (checked.value === tag.id) {
    checked.value = tags.value[0].id
    emitter.emit('refresh')
  }
}

// 获取标签下的 marks 数量
const marksTotals = ref<number[]>([])
async function getTagTotal() {
  marksTotals.value.length = 0
  for (let index = 0; index < tags.value.length; index++) {
    const total = await db.marks.where({ tag: tags.value[index].id }).count()
    marksTotals.value[index] = total
  }
}
</script>
