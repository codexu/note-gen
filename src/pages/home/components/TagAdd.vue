<template>
  <v-tooltip v-if="!showInput" text="新增标签" location="bottom">
    <template v-slot:activator="{ props }">
      <v-btn icon @click="create" v-bind="props">
        <v-icon>mdi-tab-plus</v-icon>
      </v-btn>
    </template>
  </v-tooltip>
  <v-text-field
    v-if="showInput"
    v-tooltip:bottom="'创建的标签将在下方可见'"
    type="text"
    label="标签名"
    variant="underlined"
    density="comfortable"
    autofocus
    hide-details
    v-model="model"
    @update:focused="handleFocus"
    clearable
  ></v-text-field>
  <v-snackbar :timeout="2000" v-model="snackbar">
    标签创建失败（可能重复创建）。
  </v-snackbar>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import {db} from '../../../db.ts';
import emitter from '../../../emitter.ts'

const showInput = ref(false)
const model = ref('')
const snackbar = ref(false)

function create() {
  showInput.value = true
}

async function handleFocus(isFocused: boolean) {
  if (isFocused) return;
  if (model.value.length) {
    await db.tags.add({
      name: model.value,
      createdAt: new Date().getTime()
    })
    .then(() => {
      emitter.emit('refresh')
    })
    .catch(() => {
      snackbar.value = true
    })
    model.value = ''
  }
  showInput.value = false
}
</script>
