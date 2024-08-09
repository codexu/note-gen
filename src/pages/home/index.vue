<template>
  <header class="flex fixed top-0 left-0 w-full justify-between items-center p-4 bg-white shadow z-50">
    <Tags />
    <a-space>
      <Screenshot />
      <Create />
    </a-space>
  </header>
  <div class="p-4 pt-20 bg-gray-100 min-h-screen">
    <NoteTemp />
  </div>
</template>

<script setup lang="ts">
import NoteTemp from "../../components/NoteTemp.vue";
import Screenshot from "../../components/Screenshot.vue";
import Tags from '../../components/Tags.vue'
import Create from '../../components/Create.vue'
</script>