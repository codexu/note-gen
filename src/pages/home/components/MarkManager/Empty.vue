<template>
  <div class="w-full h-full empty-wrap flex justify-center items-center border-e-thin">
    <v-empty-state
      icon="mdi-alert-circle-outline"
      title="赶快去生成一条 Mark 吧！"
      text="你可以通过以下方式："
    >
      <v-card
        v-for="(item, index) in list" :key="index"
        class="w-[310px] mb-2"
        variant="outlined"
        :prepend-icon="item.icon"
        :title="item.title"
        :text="item.text"
      ></v-card>
    </v-empty-state>
  </div>
</template>

<script setup lang="ts">
const list = [
  {
    icon: 'mdi-vector-square-plus',
    title: '截图记录',
    text: '截图后通过 OCR 识别图片记录内容。'
  },
  {
    icon: 'mdi-clipboard-text-multiple-outline',
    title: '文本记录',
    text: '常规方式，直接复制文本记录。'
  },
  {
    icon: 'mdi-image-plus-outline',
    title: '图片记录',
    text: '通过识别图片内容，将其插入到笔记中。'
  },
]
</script>