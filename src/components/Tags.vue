<template>
  <div class="d-flex ga-2">
    <v-btn v-if="!isOption" @click="isOption = true" icon="mdi-content-save-outline"></v-btn>
    <v-btn v-else @click="isOption = false" icon="mdi-cog"></v-btn>
    <v-chip :bordered="false" v-if="isOption" v-for="tag in tags" :key="tag.id" :closable="tag.name !== '记点儿'" @close="remove(tag.id)">
      {{ tag.name }}
    </v-chip>
    <div>
      <v-text-field label="新标签名称" variant="underlined" required v-if="inputVisible" ref="inputRef" v-model="inputValue" type="text" size="small"
        @blur="add" @keyup.enter="add" />
      <v-chip v-else @click="showInput" class="cursor-pointer">
        <plus-outlined />
        新标签
      </v-chip>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { notification } from 'ant-design-vue';
import { db, type Tag } from '../db.ts';
import { nextTick, onMounted, ref } from 'vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import { useStorage } from '@vueuse/core'

const tags = ref<Tag[]>([])
const isOption = useStorage('isTagOption', false)
const inputVisible = ref(false)
const inputValue = ref('')

// 查询 tags
async function queryTags() {
  const res = await db.tags.toArray()
  tags.value = res
}

onMounted(async () => {
  queryTags()
})

const inputRef = ref();
async function showInput() {
  inputVisible.value = true;
  await nextTick();
  inputRef.value.focus();

};

async function add() {
  if (inputValue.value.length === 0) return
  await db.tags.add({
    name: inputValue.value,
    createdAt: new Date().getTime()
  }).catch(() => {
    notification.error({
      message: '添加失败',
      description: '该标签已存在',
      duration: 2
    })
  })
  inputValue.value = ''
  inputVisible.value = false
  queryTags()
}

async function remove(id: number) {
  await db.tags.delete(id)
  queryTags()
}
</script>
