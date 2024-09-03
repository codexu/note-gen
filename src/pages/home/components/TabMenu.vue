<template>
  <div class="w-64 h-screen flex flex-col justify-between border-e-thin bg-gray-50">
    <div class="flex justify-rounded h-12 items-center bg-gray-100 border-b-thin">
      <TabAdd class="hover:text-[#1967C0]" />
      <v-icon size="small" class="flex-1 border-e-thin" v-tooltip="'搜索'">mdi-tab-search</v-icon>
      <div class="flex-1 flex justify-center cursor-pointer items-center text-sm hover:text-[#1967C0]"
        @click="handleEdit"
        v-tooltip="isEditing ? '关闭编辑模式' : '打开编辑模式'"
        v-if="!showInput"
      >
        <v-icon v-if="!isEditing">mdi-credit-card-edit-outline</v-icon>
        <v-icon v-else>mdi-content-save-outline</v-icon>
      </div>
    </div>
    <MarkTab class="flex-1 overflow-y-auto story-scroll" />
  </div>
</template>

<script lang="ts" setup>
import MarkTab from './MarkTab.vue';
import TabAdd from './TabAdd.vue'
import { storeToRefs } from 'pinia';
import useTabStore from '../../../stores/tab.ts'

const tabStore = useTabStore()

const { isEditing, showInput } = storeToRefs(tabStore)

function handleEdit() {
  isEditing.value = !isEditing.value
}
</script>
