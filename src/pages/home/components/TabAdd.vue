<template>
  <v-btn v-if="!showInput" icon @click="create" v-tooltip="'新增标签'">
    <v-icon>mdi-tab-plus</v-icon>
  </v-btn>
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
import useTabStore from '../../../stores/tab.ts'

const tabStore = useTabStore()

const showInput = ref(false)
const model = ref('')
const snackbar = ref(false)

function create() {
  showInput.value = true
}

async function handleSubmit(event?: KeyboardEvent) {
  event?.preventDefault()
  if (model.value.length) {
    const tabId = await tabStore.createTab(model.value)
    if (tabId) {
      model.value = ''
      showInput.value = false
    } else {
      snackbar.value = true
    }
  } else {
    showInput.value = false
  }
}
</script>
