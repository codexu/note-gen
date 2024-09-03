<template>
  <v-col
    v-for="screenshot in screenshotList"
    :key="screenshot.id"
    cols="12" xs="12" sm="6" md="64" lg="4" xl="3" xxl="2"
  >
    <v-card>
      <template v-slot:loader>
        <v-progress-linear
          :active="true"
          color="blue"
          class="bg-white"
          height="4"
          indeterminate
        ></v-progress-linear>
      </template>
      <div class="h-48 overflow-hidden">
        <v-skeleton-loader v-if="!screenshot.path" :height="192" type="image"></v-skeleton-loader>
        <v-img
          v-else
          :height="192"
          :aspect-ratio="2"
          class="h-full cursor-pointer hover:scale-125 duration-1000 transition-transform"
          :src="convertFileSrc(screenshot.path)"
          cover
        >
        </v-img>
        <v-checkbox
          disabled
          class="absolute top-0 right-2"
          color="primary"
        ></v-checkbox>
      </div>
      <div v-if="!screenshot.keywords.length" class="flex mt-6 ml-2 pb-2">
        <v-skeleton-loader
          v-for="loader in 5"
          :key="loader"
          type="chip"
        ></v-skeleton-loader>
      </div>
      <v-chip-group v-else class="mt-4 ml-4">
        <v-chip size="small" v-for="keyword in screenshot.keywords" :key="keyword">{{ keyword }}</v-chip>
      </v-chip-group>
      <div v-if="!screenshot.description.length" class="px-4 mt-3 pt-1 mb-2">
        <v-skeleton-loader
          type="list-item-two-line"
        ></v-skeleton-loader>
      </div>
      <p v-else class="px-4 text-sm leading-6 mt-2 h-12 mb-4 overflow-hidden line-clamp-2">{{ screenshot.description }}</p>
      <v-divider></v-divider>
      <v-card-actions class="flex justify-between">
        <div>
          <v-btn
            size="small"
            disabled
            color="primary"
            icon="mdi-swap-horizontal"
          ></v-btn>
          <v-btn size="small" color="error" disabled icon="mdi-delete"></v-btn>
        </div>
        <span class="mb-0 text-sm text-gray-400 pr-2">{{ screenshot.screenshotProgress }}</span>
      </v-card-actions>
    </v-card>
  </v-col>
</template>

<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import useScreenshotStore from '../../../stores/screenshot.ts'
import { convertFileSrc } from '@tauri-apps/api/tauri';

const screenshotStore = useScreenshotStore()
const { screenshotList } = storeToRefs(screenshotStore)
</script>

<style lang="scss" scoped>
:deep() {
  .v-skeleton-loader__image{
    height: 100%;
  }
  .v-skeleton-loader__chip{
    width: 48px;
    height: 26px;
    margin: 0;
    margin-left: 8px;
  }
  .v-skeleton-loader__text{
    margin: 0;
    margin-bottom: 12px;
  }
}
</style>