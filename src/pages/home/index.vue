<template>
  <main class="flex-1 flex w-full h-screen overflow-hidden">
    <TabManager />
    <section class="w-96 h-screen overflow-hidden">
      <MarkManager />
    </section>
    <section class="flex-1 h-screen overflow-hidden">
      <NoteManager />
    </section>
  </main>
</template>

<script setup lang="ts">
import MarkManager from "./components/MarkManager/index.vue";
import TabManager from "./components/TabManager/index.vue";
import NoteManager from "./components/NoteManager/index.vue";
</script>
