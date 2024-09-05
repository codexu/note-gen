<template>
  <div class="w-full h-[calc(100%-30px)] empty-wrap flex justify-center items-center border-e-thin">
    <v-empty-state
      :style="{ opacity: props.disabled ? 0.2 : 1 }"
      :color="color"
      :icon="icon"
      :title="title"
      :text="text"
    >
    </v-empty-state>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  disabled: boolean
}>()

const color = computed(() => {
  if (props.disabled) {
    return 'default'
  }
  return 'success'
})

const icon = computed(() => {
  if (props.disabled) {
    return 'mdi-cancel'
  }
  return 'mdi-text-box-check-outline'
})

const title = computed(() => {
  if (props.disabled) {
    return '无法生成笔记'
  }
  return '可整理笔记'
})

const text = computed(() => {
  if (props.disabled) {
    return '至少选择一条 Mark 才可以整理成笔记！'
  }
  return '请点击整理笔记，会自动将选中的 Mark 整理成笔记！'
})
</script>