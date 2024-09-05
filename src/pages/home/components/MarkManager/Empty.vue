<template>
  <div class="w-full h-full empty-wrap flex justify-center items-center border-e-thin">
    <v-empty-state
      color="success"
      icon="mdi-alert-circle-outline"
      title="赶快去生成一条 Mark 吧！"
      text="你可以通过以下方式："
    >
      <v-card
        v-for="(item, index) in list" :key="index"
        class="w-[310px] mb-2 cursor-pointer"
        variant="outlined"
        :prepend-icon="item.icon"
        :title="item.title"
        :subtitle="item.subtitle"
        append-icon="mdi-cursor-default-click"
        :disabled="item.disabled"
      ></v-card>
    </v-empty-state>
  </div>
</template>

<script setup lang="ts">
const list = [
  {
    icon: 'mdi-vector-square-plus',
    title: '截图记录',
    subtitle: 'Option Or Alt + X',
    disabled: false,
  },
  {
    icon: 'mdi-clipboard-text-multiple-outline',
    title: '文本记录',
    subtitle: 'Option Or Alt + C',
    disabled: true
  },
  {
    icon: 'mdi-image-plus-outline',
    title: '图片记录',
    subtitle: 'Option Or Alt + V',
    disabled: true
  },
]
</script>