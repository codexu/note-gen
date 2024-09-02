<template>
  <main class="flex h-screen overflow-hidden">
    <AsideMenu />
    <section class="w-96 h-screen story-scroll p-2 border-e-thin">
      <ListMark />
    </section>
    <section class="flex-1 h-screen story-scroll">
      <NoteEditer />
    </section>
  </main>
</template>

<script setup lang="ts">
import ListMark from "./components/ListMark.vue";
import AsideMenu from "./components/AsideMenu.vue";
import NoteEditer from "./components/NoteEditer.vue";
</script>
