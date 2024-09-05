<template>
  <div class="h-screen flex-1 overflow-hidden flex flex-col" v-if="activated[0]">
    <ArticleTool />
    <ArticleEditor />
  </div>
</template>

<script lang="ts" setup>
import ArticleTool from './ArticleTool.vue';
import ArticleEditor from './ArticleEditor.vue';
import useArticleStore from '../../../../stores/article.ts'
import { storeToRefs } from 'pinia';

const articleStore = useArticleStore()
const { activated } = storeToRefs(articleStore)
</script>

<style lang="scss" scoped>

</style>
