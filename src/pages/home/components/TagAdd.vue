<template>
  <v-tooltip v-if="!showInput" text="新增标签" location="bottom">
    <template v-slot:activator="{ props }">
      <v-btn icon @click="create" v-bind="props">
        <v-icon>mdi-tab-plus</v-icon>
      </v-btn>
    </template>
  </v-tooltip>
  <v-text-field
    class="min-w-60"
    v-if="showInput"
    append-inner-icon="mdi-check"
    type="text"
    label="标签名"
    variant="underlined"
    density="comfortable"
    autofocus
    hide-details
    v-model="model"
    @keydown.enter="handleSubmit"
    @click:append-inner="handleSubmit()"
  ></v-text-field>
  <v-snackbar :timeout="2000" v-model="snackbar">
    标签创建失败（可能重复创建）。
  </v-snackbar>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { useStorage } from '@vueuse/core';
import {db} from '../../../db.ts';
import emitter from '../../../emitter.ts'

const currentTag = useStorage('currentTag', 0)
const showInput = ref(false)
const model = ref('')
const snackbar = ref(false)

function create() {
  showInput.value = true
}

async function handleSubmit(event?: KeyboardEvent) {
  event?.preventDefault()
  if (model.value.length) {
    const tagId = await db.tags.add({
      name: model.value,
      createdAt: new Date().getTime()
    })
    .catch(() => {
      snackbar.value = true
    })
    if (tagId) {
      currentTag.value = tagId
      emitter.emit('refresh')
      model.value = ''
    }
  }
  showInput.value = false
}
</script>
