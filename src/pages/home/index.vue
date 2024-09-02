<template>
  <main class="flex w-full h-screen overflow-hidden">
    <AsideMenu />
    <section class="w-96 h-screen overflow-hidden">
      <ListMark />
    </section>
    <section class="flex-1 h-screen overflow-hidden">
      <NoteEditer />
    </section>
  </main>
</template>

<script setup lang="ts">
import ListMark from "./components/ListMark.vue";
import AsideMenu from "./components/AsideMenu.vue";
import NoteEditer from "./components/NoteEditer.vue";
</script>
