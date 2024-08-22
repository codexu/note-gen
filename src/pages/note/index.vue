<template>
  <v-card>
    <v-app-bar color="primary">
      <v-app-bar-title>
        <v-icon size="small" icon="mdi-notebook-multiple" class="-translate-y-0.5"></v-icon>
        <span class="ml-4">NoteGen</span>
      </v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn prepend-icon="mdi-note-edit-outline">生成文章</v-btn>
      <v-btn prepend-icon="mdi-keyboard-return" @click="router.back">返回</v-btn>
    </v-app-bar>
  </v-card>
  <NoteEditer />
</template>

<script lang="ts" setup>
import NoteEditer from './components/NoteEditer.vue';
import { useRouter } from 'vue-router';

const router = useRouter()
</script>

<style lang="scss" scoped>

</style>
