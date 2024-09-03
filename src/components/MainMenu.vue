<template>
  <aside class="w-12 h-screen border-e-thin flex flex-col justify-between bg-gray-50">
    <div>
      <v-btn variant="plain" icon="mdi-puzzle-heart" :active="true" v-tooltip:end="'笔记'"></v-btn>
      <v-btn variant="plain" icon="mdi-note-edit-outline" v-tooltip:end="'文章'"></v-btn>
      <v-btn variant="plain" icon="mdi-home-search-outline" v-tooltip:end="'全局搜索'"></v-btn>
      <v-btn variant="plain" icon="mdi-star-outline" v-tooltip:end="'收藏'"></v-btn>
    </div>
    <div>
      <v-btn variant="plain" icon="mdi-help-circle-outline"></v-btn>
      <v-btn variant="plain" icon="mdi-cog-outline"></v-btn>
    </div>
  </aside>
</template>
