<template>
  <v-tooltip text="整理" location="bottom">
    <template v-slot:activator="{ props }">
      <v-btn prepend-icon="mdi-puzzle-edit-outline" @click="create" v-bind="props">
        整理
      </v-btn>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router';

const router = useRouter()
function create() {
  router.push({ name: 'note' })
}
</script>
