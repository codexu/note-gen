<template>
  <template v-for="screenshot in store.screenshotList" :key="screenshot.id">
    <div class="bg-white mb-2 p-4 flex">
      <a-skeleton-image class="mr-4" />
      <div class="flex flex-col flex-1">
        <a-space>
          <a-skeleton-avatar size="small" active v-for="(index) in 5" :key="index" shape="round" />
        </a-space>
        <a-skeleton size="small" class="mt-4 mb-2 w-full" :paragraph="{ rows: 3 }" active :title="false" />
        <div class="flex justify-between items-end">
          <a-space>
            <a-skeleton-button active size="small" />
            <a-skeleton-button active size="small" />
          </a-space>
          <span class="mb-0 text-sm text-gray-400">正在{{ screenshot.screenshotProgress }}</span>
        </div>
      </div>
    </div>
  </template>
</template>

<script lang="ts" setup>
import useStore from '../../../store.ts'

const store = useStore()
</script>
