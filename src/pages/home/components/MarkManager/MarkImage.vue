<template>
  <v-dialog max-width="800" @afterEnter="afterEnter">
    <template v-slot:activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        :loading="loading"
        size="small"
        variant="text"
        icon="mdi-image-plus-outline"
        v-tooltip="'插图记录'"
      ></v-btn>
    </template>

    <template v-slot:default="{ isActive }">
      <v-card title="插图记录">
        <v-card-text>
          <div class="mb-2">
            导入图片后会自动将其上传至图床，并在整理笔记时，自动插入到适合的位置。
          </div>
          <v-skeleton-loader type="card" v-if="loading"></v-skeleton-loader>
          <img v-else class="max-h-96" :src="imageData" />
          <div v-if="readStatus" class="flex items-center text-sm">
            <div v-if="readStatus === 'success'">
              <v-icon color="success" size="small" class="mr-1">mdi-check-circle-outline</v-icon>
              <span class="text-green">已识别到剪贴板的图片。</span>
            </div>
            <div v-else-if="readStatus === 'error'">
              <v-icon color="error" size="small" class="mr-1">mdi-close-circle-outline</v-icon>
              <span class="text-red">未识别到剪贴板的图片。</span>
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            :disabled="readStatus === 'error'"
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
import clipboard from "tauri-plugin-clipboard-api";
import { nextTick, Ref, ref } from 'vue';
import base64ToUint8Array from '../../../../utils/base64ToUint8Array'
import { BaseDirectory, writeBinaryFile } from "@tauri-apps/api/fs";
import { appDataDir } from "@tauri-apps/api/path";
import useMarkStore, { defaultCreatingStatus } from '../../../../stores/marks.ts';
import { storeToRefs } from "pinia";
import { clone } from "lodash";
import { v4 as uuidv4 } from 'uuid';
import { db } from "../../../../db.ts";
import storage from 'store'
import { invoke } from "@tauri-apps/api/tauri";
import takeDescription from "../../../../utils/takeDescription.ts";

const markStore = useMarkStore()
const { creatingList } = storeToRefs(markStore)

let base64String = '';
const imageData = ref('')
const readStatus = ref<'success' | 'error' | null>()
const loading = ref(false)

async function afterEnter() {
  readStatus.value = null
  imageData.value = ''
  loading.value = true
  clipboard
    .readImageBase64()
    .then((base64Img) => {
      base64String = base64Img
      imageData.value = `data:image/png;base64, ${base64Img}`;
      readStatus.value = 'success';
    })
    .catch(() => {
      readStatus.value = 'error';
    })
    .finally(() => {
      loading.value = false;
    })
}

async function handleSubmit(isActive: Ref<boolean>) {
  await nextTick()
  if (base64String) {
    isActive.value = false
    // 保存图片
    const id = uuidv4()
    let result = clone(defaultCreatingStatus)
    result.id = id
    result.screenshotProgress = '保存图片'
    creatingList.value.unshift(clone(result))
    const data = base64ToUint8Array(base64String);
    const filePath = `assets/${id}.png`
    await writeBinaryFile(filePath, data, { dir: BaseDirectory.AppData });

    const appDataDirPath = await appDataDir();
    const imgPath = appDataDirPath + filePath

    // 文字识别
    result.screenshotProgress = '识别文字'
    markStore.updateStatus(clone(result))
    const content = await invoke<string>("lt_ocr", { path: imgPath });

    // 分析内容，提取描述
    result.screenshotProgress = '分析内容'
    markStore.updateStatus(clone(result))
    const description = await takeDescription(content)
    result.description = description

    const tabId = storage.get('currentTab')
    await db.marks.add({
      imgPath,
      keywords: ['插图'],
      description,
      type: "image",
      status: true,
      content: "",
      tab: tabId,
      deleted: false,
      createdAt: new Date().getTime()
    })
    markStore.complete(id)
    markStore.getMarks(tabId)
    imageData.value = ''
  }
}
</script>

<style lang="scss" scoped>

</style>
