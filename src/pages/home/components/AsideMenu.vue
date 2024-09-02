<template>
  <div class="w-64 h-screen flex flex-col justify-between border-e-thin">
    <v-tabs fixed-tabs align-tabs="center" color="primary">
      <v-tab value="one">笔记</v-tab>
      <v-tab value="two">文章</v-tab>
    </v-tabs>
    <v-divider></v-divider>
    <MarkTab class="flex-1 overflow-y-auto story-scroll" />
    <v-divider></v-divider>
    <div class="flex justify-rounded h-10 items-center">
      <TabAdd class="hover:text-[#1967C0]" />
      <div class="flex-1 flex justify-center cursor-pointer items-center text-sm hover:text-[#1967C0]"
        @click="handleEdit"
        v-tooltip="isEditing ? '关闭编辑模式' : '打开编辑模式'"
        v-if="!showInput"
      >
        <v-icon size="small" v-if="!isEditing">mdi-cog-outline</v-icon>
        <v-icon size="small" v-else>mdi-cog-off-outline</v-icon>
      </div>
    </div>
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
