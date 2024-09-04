<template>
  <v-app>
    <router-view></router-view>
  </v-app>
</template>

<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { screenshot, screenshotEnd, registerGlobalShortcut } from './utils/screenshot'
import { onMounted } from "vue";
import createDefaultFolder from './utils/createDefaultFolder.ts'

onMounted(() => {
  listen('screenshot', screenshot);
  listen('screenshot_end', screenshotEnd);
  registerGlobalShortcut()
  createDefaultFolder()
})
</script>