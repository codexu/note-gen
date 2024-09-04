<template>
  <div class="w-64 h-screen flex flex-col border-e-thin bg-gray-50">
    <div class="flex justify-rounded h-12 items-center bg-gray-100 border-b-thin">
      <v-icon size="small" class="flex-1 border-e-thin" v-tooltip="'新建文件夹'">mdi-folder-plus-outline</v-icon>
      <v-icon size="small" class="flex-1 border-e-thin" v-tooltip="'搜索'">mdi-folder-search-outline</v-icon>
      <v-icon size="small" class="flex-1" v-tooltip="'打开文件夹'">mdi-folder-open-outline</v-icon>
    </div>
    <ArticleTree />
  </div>
</template>

<script lang="ts" setup>
import ArticleTree from './ArticleTree.vue';
</script>

<style lang="scss" scoped>

</style>
