<template>
  <v-dialog max-width="800" @afterEnter="afterEnter">
    <template v-slot:activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        :loading="loading"
        size="small"
        variant="text"
        icon="mdi-clipboard-text-multiple-outline"
        v-tooltip="'文字记录'"
      ></v-btn>
    </template>

    <template v-slot:default="{ isActive }">
      <v-card title="文字记录">
        <v-card-text>
          <div class="mb-2">
            记录一段文本，笔记整理时将插入到合适的位置。
          </div>
          <v-textarea
            v-model="text"
            rows="8"
            variant="outlined"
            persistent-counter
          ></v-textarea>
          <div v-if="readStatus" class="flex items-center text-sm">
            <v-icon color="success" size="small" class="mr-1">mdi-check-circle-outline</v-icon>
            <span class="text-green">已自动粘贴剪贴板内容。</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            :loading="loading"
            text="记录"
            @click="handleSubmit(isActive)"
          ></v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-dialog>
</template>

<script lang="ts" setup>
import { readText } from '@tauri-apps/api/clipboard';
import { nextTick, Ref, ref } from 'vue';
import storage from 'store'
import { db } from '../../../../db';
import { invoke } from '@tauri-apps/api/tauri';
import takeDescription from '../../../../utils/takeDescription.ts'
import useMarkStore, { defaultCreatingStatus } from '../../../../stores/marks.ts';
import { storeToRefs } from 'pinia';
import { clone } from 'lodash';
import { v4 as uuidv4 } from 'uuid';

const markStore = useMarkStore()
const { creatingList } = storeToRefs(markStore)

const text = ref('')
const readStatus = ref(false)
const loading = ref(false)

async function afterEnter() {
  const res = await readText()
  if (res) {
    readStatus.value = true
    text.value = res
  } else {
    readStatus.value = false
    text.value = ''
  }
}

async function handleSubmit(isActive: Ref<boolean>) {
  if (text.value) {
    isActive.value = false
    let result = clone(defaultCreatingStatus)
    const id = uuidv4()
    result.id = id
    result.screenshotProgress = '识别文字'
    creatingList.value.unshift(clone(result))
    await nextTick();
    const keywords = await invoke("cut_words", {
      str: text.value
    }) as string[]
    result.keywords = keywords
    result.screenshotProgress = '分析内容'
    markStore.updateStatus(clone(result))
    const description = await takeDescription(text.value)
    result.description = description
    markStore.updateStatus(clone(result))
    await db.marks.add({
      content: text.value,
      type: 'text',
      status: true,
      imgPath: '',
      description,
      tab: storage.get('currentTab'),
      keywords,
      deleted: false,
      createdAt: new Date().getTime()
    })
    await markStore.getMarks(storage.get('currentTab'))
    text.value = ''
    markStore.complete(result.id)
  }
}
</script>

<style lang="scss" scoped>

</style>
