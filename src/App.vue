<template>
  <header class="flex fixed top-0 left-0 w-full justify-between items-center p-4 bg-white shadow">
    <Tags />
    <Screenshot />
  </header>
  <div class="container p-4 pt-24">
    <NoteTemp />
  </div>
</template>

<script setup lang="ts">
import NoteTemp from "./components/NoteTemp.vue";
import Screenshot from "./components/Screenshot.vue";
import Tags from './components/Tags.vue'
</script>