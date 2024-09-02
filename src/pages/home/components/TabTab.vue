<template>
  <div class="w-full flex items-center justify-between">
    <v-tabs
      class="flex-1"
      v-model="checked"
      align-tabs="title"
      show-arrows
      @update:model-value="segmentedChange"
    >
      <v-tab
        v-for="tab in tabs"
        :key="tab.id"
        :value="tab.id"
      >
        <span v-if="!isEditing">{{ tab.name }}</span>
        <input v-else class="tab-edit" type="text" v-model="tab.name" @change="updateTabName(tab.id)" />
        <v-icon
          v-if="tab.name !== DEFAULT_TAB_NAME && isEditing"
          @click="tabStore.deleteTab(tab, $event)"
          class="ml-2"
          icon="mdi-close"
        ></v-icon>
        <v-badge
          v-else-if="tab.total > 0"
          color="error"
          :content="tab.total"
          inline
        ></v-badge>
      </v-tab>
    </v-tabs>
    <div class="flex pr-1">
      <TabAdd />
      <v-btn icon @click="handleEdit" v-tooltip="'编辑标签'">
        <v-icon v-if="!isEditing">mdi-cog-outline</v-icon>
        <v-icon v-else>mdi-cog-off-outline</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import TabAdd from './TabAdd.vue'
import { onMounted, ref } from 'vue';
import useTabStore, { DEFAULT_TAB_NAME } from '../../../stores/tab.ts'
import { storeToRefs } from 'pinia';

const tabStore = useTabStore()

const { tabs, checked } = storeToRefs(tabStore)

onMounted(async () => {
  await tabStore.createDefaultTab()
  await tabStore.queryTabs()
})

const isEditing = ref(false)
function handleEdit() {
  isEditing.value = !isEditing.value
}

function segmentedChange(id: unknown) {
  checked.value = id as number
}

function updateTabName(id: number) {
  tabStore.updateTabName(id)
}
</script>

<style lang="scss" scoped>
.tab-edit{
  color: #fff;
  outline: none;
}
</style>