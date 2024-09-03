<template>
  <aside class="w-12 h-screen border-e-thin flex flex-col justify-between bg-gray-50">
    <div>
      <v-btn variant="plain" icon="mdi-puzzle-heart" v-tooltip:end="'笔记'"></v-btn>
      <v-btn variant="plain" icon="mdi-note-edit" v-tooltip:end="'文章'"></v-btn>
      <v-btn variant="plain" icon="mdi-home-search" v-tooltip:end="'全局搜索'"></v-btn>
    </div>
    <v-btn variant="plain" icon="mdi-cog"></v-btn>
  </aside>
</template>

<script lang="ts" setup>

</script>

<style lang="scss" scoped>

</style>
