<template>
  <a-space>
    <div>
      <a-button size="small" v-if="!isOption" @click="isOption = true" :icon="h(SettingOutlined)">
      </a-button>
      <a-button size="small" v-else @click="isOption = false" :icon="h(SaveOutlined)">
      </a-button>
    </div>
    <a-segmented v-show="!isOption" v-model:value="checked" :options="segmentedOptions" @change="segmentedChange" />
    <a-tag :bordered="false" v-if="isOption" v-for="tag in tags" :key="tag.id" :closable="tag.name !== '记点儿'" @close="remove(tag.id)">
      {{ tag.name }}
    </a-tag>
    <div>
      <a-input v-if="inputVisible" ref="inputRef" v-model:value="inputValue" type="text" size="small"
        :style="{ width: '78px' }" @blur="add" @keyup.enter="add" />
      <a-tag v-else @click="showInput" class="cursor-pointer">
        <plus-outlined />
        新标签
      </a-tag>
    </div>
  </a-space>
</template>

<script lang="ts" setup>
import { notification } from 'ant-design-vue';
import { db, type Tag } from '../db.ts';
import { computed, nextTick, onMounted, ref, h } from 'vue';
import { PlusOutlined, SettingOutlined, SaveOutlined } from '@ant-design/icons-vue';
import { useStorage } from '@vueuse/core'
import emitter from '../emitter.ts'

const checked = useStorage('currentTag', '记点儿')

async function segmentedChange() {
  await nextTick()
  emitter.emit('refresh')
}

const tags = ref<Tag[]>([])
const isOption = useStorage('isTagOption', false)
const inputVisible = ref(false)
const inputValue = ref('')

const segmentedOptions = computed(() => {
  return tags.value.map((tag) => tag.name)
})

// 创建默认标签：记点儿，判断 tags 是否存在 name 是记点儿的标签
async function createDefaultTag() {
  const hasTag = await db.tags.where({ name: '记点儿' }).count()
  if (!hasTag) {
    await db.tags.add({ name: '记点儿' })
  }
}

// 查询 tags
async function queryTags() {
  const res = await db.tags.toArray()
  tags.value = res
}

onMounted(async () => {
  await createDefaultTag()
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
  await db.tags.add({ name: inputValue.value }).catch(() => {
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
