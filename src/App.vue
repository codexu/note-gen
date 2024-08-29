<template>
  <v-app>
    <router-view></router-view>
  </v-app>
</template>

<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { screenshot, screenshotEnd } from './utils/screenshot'
import { onMounted } from "vue";

onMounted(() => {
  listen('screenshot', screenshot);
  listen('screenshot_end', screenshotEnd);
})
</script>