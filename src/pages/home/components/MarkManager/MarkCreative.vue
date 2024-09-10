<template>
  <div v-for="item in creatingList" :key="item.id">
    <v-card class="m-2">
      <div class="flex">
        <div class="h-28 w-28 overflow-hidden">
          <v-skeleton-loader v-if="!item.path" :height="192" type="image"></v-skeleton-loader>
          <v-img
            v-else
            :height="192"
            :aspect-ratio="2"
            class="h-full cursor-pointer hover:scale-125 duration-1000 transition-transform"
            :src="convertFileSrc(item.path)"
            cover
          >
          </v-img>
        </div>
        <div class="flex-1">
          <div class="flex justify-between h-6 mt-1">
            <div v-if="!item.keywords.length" class="flex mt-1">
              <v-skeleton-loader
                v-for="loader in 3"
                :key="loader"
                type="chip"
              ></v-skeleton-loader>
            </div>
            <v-chip-group v-else class="!py-0 px-2">
              <v-chip variant="flat" label size="x-small" v-for="keyword in item.keywords" :key="keyword">{{ keyword }}</v-chip>
            </v-chip-group>
            <v-checkbox
              disabled
              class="scale-75 translate-y-[-10px] translate-x-1"
              color="primary"
            ></v-checkbox>
          </div>
          <div v-if="!item.description.length" class="px-2 mt-3">
            <v-skeleton-loader
              type="list-item-two-line"
            ></v-skeleton-loader>
          </div>
          <p v-else class="text-xs leading-5 mt-2 mb-1 line-clamp-2 px-2">{{ item.description }}</p>
          <div class="flex justify-between items-center px-2">
            <div>
              <v-btn
                size="x-small"
                variant="plain"
                disabled
                icon="mdi-swap-horizontal"
              ></v-btn>
              <v-btn size="x-small" variant="plain" color="error" disabled icon="mdi-delete"></v-btn>
            </div>
            <span class="mb-0 text-xs text-gray-400">{{ item.screenshotProgress }}</span>
          </div>
        </div>
      </div>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import useMarkStore from '../../../../stores/marks.ts'
import { convertFileSrc } from '@tauri-apps/api/tauri';

const markStore = useMarkStore()
const { creatingList } = storeToRefs(markStore)
</script>

<style lang="scss" scoped>
:deep() {
  .v-skeleton-loader__image{
    height: 100%;
  }
  .v-skeleton-loader__chip{
    width: 32px;
    height: 18px;
    margin: 0;
    margin-left: 8px;
    border-radius: 4px;
  }
  .v-skeleton-loader__text{
    margin: 0;
    margin-bottom: 8px;
    border-radius: 4px;
  }
}
</style>