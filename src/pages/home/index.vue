<template>
  <main class="flex-1 flex w-full h-screen overflow-hidden">
    <TabMenu />
    <section class="w-96 h-screen overflow-hidden">
      <MarkList />
    </section>
    <section class="flex-1 h-screen overflow-hidden">
      <NoteEditer />
    </section>
  </main>
</template>

<script setup lang="ts">
import MarkList from "./components/MarkList.vue";
import TabMenu from "./components/TabMenu.vue";
import NoteEditer from "./components/NoteEditer.vue";
</script>
