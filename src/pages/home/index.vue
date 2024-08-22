<template>
  <v-card>
    <v-app-bar color="primary">
      <v-app-bar-nav-icon></v-app-bar-nav-icon>
      <v-app-bar-title>NoteGen</v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-magnify"></v-btn>
      <Screenshot />
      <TagAdd />
      <CreateNote />
      <template v-slot:extension>
        <TagTab />
      </template>
    </v-app-bar>
  </v-card>
  <div class="note-wrap p-6">
    <!-- <ScreenshotStatus /> -->
    <NoteTemp />
  </div>
</template>

<script setup lang="ts">
import NoteTemp from "./components/NoteTemp.vue";
// import ScreenshotStatus from "./components/ScreenshotStatus.vue";
import Screenshot from "../../components/Screenshot.vue";
import TagTab from './components/TagTab.vue'
import TagAdd from './components/TagAdd.vue'
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