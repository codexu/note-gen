<template>
  <v-app-bar color="primary">
    <v-app-bar-title>
      <v-icon size="small" icon="mdi-notebook-multiple" class="-translate-y-0.5"></v-icon>
      <span class="ml-4">NoteGen</span>
    </v-app-bar-title>
    <v-spacer></v-spacer>
    <v-btn prepend-icon="mdi-monitor-screenshot" @click="screenshot">记录</v-btn>
    <v-btn prepend-icon="mdi-magnify">搜索</v-btn>
    <NoteCreate />
    <template v-slot:extension>
      <TabTab />
    </template>
  </v-app-bar>
  <div class="note-wrap p-6 bg-gray-50">
    <ListMark />
  </div>
</template>

<script setup lang="ts">
import ListMark from "./components/ListMark.vue";
import TabTab from './components/TabTab.vue'
import NoteCreate from './components/NoteCreate.vue'
import { screenshot } from "../../utils/screenshot";
</script>

<style>
.note-wrap {
  height: calc(100vh - 116px);
  margin-top: 116px;
  overflow-x: hidden;
  overflow-y: auto;
}
</style>