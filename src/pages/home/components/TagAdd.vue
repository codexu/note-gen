<template>
  <v-tooltip text="新增标签" location="bottom">
    <template v-slot:activator="{ props }">
      <v-btn icon @click="create" v-bind="props">
        <v-icon>mdi-tab-plus</v-icon>
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
