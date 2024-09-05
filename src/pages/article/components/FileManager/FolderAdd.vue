<template>
  <div class="flex-1 border-e-thin flex justify-center cursor-pointer">
    <div v-if="!showInput" @click="handleShow" class="w-full flex justify-center" v-tooltip="'创建目录'">
      <v-icon size="small">mdi-folder-plus-outline</v-icon>
    </div>
    <v-text-field
      class="absolute top-0 left-0 right-0 bg-white z-10"
      v-if="showInput"
      append-inner-icon="mdi-check"
      type="text"
      label="目录名称"
      density="comfortable"
      autofocus
      hide-details
      v-model="model"
      @keydown.enter="handleSubmit"
      @click:append-inner="handleSubmit()"
    ></v-text-field>
    <v-snackbar :timeout="2000" v-model="snackbar">
      目录创建失败（可能重复创建）。
    </v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import useArticleStore from '../../../../stores/article.ts'

const articleStore = useArticleStore()

const showInput = ref(false)
const model = ref('')
const snackbar = ref(false)

function handleShow() {
  showInput.value = true
}

async function handleSubmit(event?: KeyboardEvent) {
  event?.preventDefault()
  if (model.value.length) {
    const isCreated = await articleStore.createFolder(model.value)
    if (isCreated) {
      model.value = ''
      showInput.value = false
      await articleStore.getFolders()
    } else {
      snackbar.value = true
    }
  } else {
    showInput.value = false
  }
}
</script>
