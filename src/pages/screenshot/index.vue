<template>
  <div class="overflow-hidden relative h-screen">
    <img
      class="w-full absolute top-0 left-0 user-img"
      :src="path"
      :style="`transform: translateY(-${imageY}px)`"
    />
    <div
      ref="pickerRef"
      :style="pickerStyle"
      class="screen-picker"
    ></div>
    <div
      class="absolute z-20 grid grid-cols-2 gap-2 bg-[#fff] bg-opacity-80 rounded shadow p-2"
      :style="(pickerUtilsStyle as StyleValue)"
    >
      <v-btn density="comfortable" prepend-icon="mdi-close" @click="handleClose">关闭</v-btn>
      <v-btn density="comfortable" prepend-icon="mdi-check" @click="handleSubmit">完成</v-btn>
    </div>
    
  </div>
</template>

<script lang="ts" setup>
import { appWindow, getAll, getCurrent } from '@tauri-apps/api/window';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { emit } from '@tauri-apps/api/event';
import { computed, onMounted, ref, StyleValue } from 'vue';
import { useRoute } from 'vue-router';
import storage from 'store';
import setSelectEvent from './selectEvent'
import setMoveEvent from './moveEvent';

const route = useRoute()

const currentWindow = getCurrent()
const id = ref<string>()
const path = ref<string>()
const imageY = ref(0)

const width = ref(0)
const height = ref(0)
const top = ref(0)
const left = ref(0)

const isMouseDown = ref(false)
const isSelected = ref(false)
const pickerRef = ref()
const isPickerMove = ref(false)
const pickerOffset = ref({ x: 0, y: 0 })

onMounted(async() => {
  const { width, height } = await currentWindow.innerSize()
  storage.set('webviewWidth', width)
  storage.set('webviewHeight', height)
  const { y } = await currentWindow.innerPosition()
  const scaleFactor = await currentWindow.scaleFactor()
  imageY.value = y / scaleFactor
  path.value = convertFileSrc(route.query.path as string)
  id.value = route.query.id as string
})

onMounted(() => {
  setSelectEvent(isMouseDown, top, left, width, height, isSelected)
  setMoveEvent(pickerRef, top, left, isPickerMove, pickerOffset)
})

const pickerStyle = computed(() => {
  return {
    width: `${width.value}px`,
    height: `${height.value}px`,
    top: `${top.value}px`,
    left: `${left.value}px`,
  }
})

const pickerUtilsStyle = computed(() => {
  return {
    top: `${top.value + height.value - 45}px`,
    left: `${left.value + width.value - 198}px`,
    visibility: isSelected.value ? 'visible' : 'hidden',
  }
})

// ESC 关闭
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    handleClose()
  }
})

function handleClose() {
  currentWindow.close()
  const allWindow = getAll()
  const mainWindow = allWindow.find((item) => item.label === 'main')
  if (mainWindow) {
    mainWindow.show()
  }
}

// 完成截图
async function handleSubmit() {
  const allWindow = getAll()
  const mainWindow = allWindow.find((item) => item.label === 'main')
  const scaleFactor = await appWindow.scaleFactor();

  const payload = {
    path: route.query.path,
    x: left.value * scaleFactor,
    y: (top.value + imageY.value) * scaleFactor,
    width: width.value * scaleFactor,
    height: height.value * scaleFactor,
  }

  const clipImagePath = await invoke<string>('screenshot_end', payload)

  emit('screenshot_end', {
    id: id.value,
    path: clipImagePath,
  })

  if (mainWindow) {
    await mainWindow.show()
  }
  await currentWindow.close()
}
</script>

<style lang="scss" scoped>
.user-img{
  user-select: none;
  -webkit-user-drag: none;
}
.screen-picker{
  position: absolute;
  z-index: 10;
  border: solid 3px #ccc;
  box-sizing: content-box;
  transform: translate(-2px, -2px);
  box-shadow: 0 0 0 100000px rgba(0, 0, 0, .5);
  cursor: move;
}
</style>