<template>
  <v-tabs
    v-model="checked"
    align-tabs="title"
    @update:model-value="segmentedChange"
  >
    <v-tab
      v-for="item in tags"
      :key="item.id"
      :text="`${item.name}`"
      :value="item.id"
    ></v-tab>
  </v-tabs>
</template>

<script lang="ts" setup>
import { useStorage } from '@vueuse/core'
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
const DEFAULT_TAG_NAME = '临时'
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

onMounted(async () => {
  await createDefaultTag();
  queryTags();
})
</script>

<style lang="scss" scoped>

</style>
