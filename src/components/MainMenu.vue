<template>
  <aside class="w-12 h-screen border-e-thin flex flex-col justify-between bg-gray-100">
    <div class="flex flex-col items-center">
      <v-btn v-for="(menu, index) in mainMenus"
        :key="index"
        variant="plain"
        :icon="route.name === menu.name ? menu.icon : menu.icon + '-outline'"
        :class="route.name === menu.name ? 'opacity-100' : ''"
        v-tooltip:end="menu.tip"
        @click="menuClick(menu.name)"
      ></v-btn>
    </div>
    <div class="flex flex-col items-center">
      <v-btn v-for="(menu, index) in otherMenus"
      :key="index"
      variant="plain"
      :icon="route.name === menu.name ? menu.icon : menu.icon + '-outline'"
      :class="route.name === menu.name ? 'opacity-100' : ''"
      v-tooltip:end="menu.tip"
      @click="menuClick(menu.name)"
    ></v-btn>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter()
const route = useRoute()

const mainMenus = ref([
  { name: 'note', icon: 'mdi-puzzle-heart', tip: '笔记' },
  { name: 'article', icon: 'mdi-note-edit', tip: '文章' },
  { name: 'collection', icon: 'mdi-star-box', tip: '收藏' },
  { name: 'image', icon: 'mdi-image', tip: '图床' },
  { name: 'search', icon: 'mdi-home-search', tip: '全局搜索' },
  { name: 'trash', icon: 'mdi-clipboard-text-clock', tip: '回收站' },
  { name: 'history', icon: 'mdi-calendar-blank', tip: '历史' },
  { name: 'platform', icon: 'mdi-cookie-cog', tip: '平台管理' },
])

const otherMenus = ref([
  { name: 'help', icon: 'mdi-help-circle', tip: '帮助' },
  { name: 'setting', icon: 'mdi-cog', tip: '设置' },
])

function menuClick(name: string) {
  router.push({ name })
}
</script>