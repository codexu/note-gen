<template>
  <v-btn prepend-icon="mdi-puzzle-edit-outline" @click="create">
    整理
  </v-btn>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router';

const router = useRouter()
function create() {
  router.push({ name: 'note' })
}
</script>
