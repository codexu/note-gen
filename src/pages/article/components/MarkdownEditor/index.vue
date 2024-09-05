<template>
  <div class="h-screen flex-1 overflow-hidden flex flex-col" v-if="activated[0]">
    <ArticleTool />
    <ArticleEditor />
  </div>
</template>

<script lang="ts" setup>
import ArticleTool from './ArticleTool.vue';
import ArticleEditor from './ArticleEditor.vue';
import useFolderStore from '../../../../stores/folders.ts'
import { storeToRefs } from 'pinia';

const folderStore = useFolderStore()
const { activated } = storeToRefs(folderStore)
</script>

<style lang="scss" scoped>

</style>
