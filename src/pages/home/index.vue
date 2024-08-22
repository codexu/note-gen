<template>
  <v-card>
    <v-app-bar color="primary">
      <v-app-bar-title>
        <v-icon size="small" icon="mdi-notebook-multiple" class="-translate-y-0.5"></v-icon>
        <span class="ml-4">NoteGen</span>
      </v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn prepend-icon="mdi-magnify">搜索</v-btn>
      <Screenshot />
      <CreateNote />
      <template v-slot:extension>
        <TagTab />
      </template>
    </v-app-bar>
  </v-card>
  <div class="note-wrap p-6 bg-gray-50">
    <NoteTemp />
  </div>
</template>

<script setup lang="ts">
import NoteTemp from "./components/NoteTemp.vue";
import Screenshot from "../../components/Screenshot.vue";
import TagTab from './components/TagTab.vue'
import CreateNote from './components/CreateNote.vue'
</script>

<style>
.note-wrap {
  height: calc(100vh - 116px);
  margin-top: 116px;
  overflow-x: hidden;
  overflow-y: auto;
}
</style>