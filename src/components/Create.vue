<template>
  <a-button type="primary" :icon="h(ExperimentOutlined)" @click="create">整理</a-button>
</template>

<script lang="ts" setup>
import { h } from 'vue'
import {ExperimentOutlined} from '@ant-design/icons-vue'
import { useRouter } from 'vue-router';

const router = useRouter()
function create() {
  console.log(1);
  router.push({ name: 'note' })
}
</script>