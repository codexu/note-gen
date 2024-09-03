<template>
  <div class="w-full flex flex-col justify-between">
    <v-tabs
      class="flex-1"
      v-model="checked"
      direction="vertical"
      @update:model-value="segmentedChange"
    >
      <v-tab
        v-for="tab in tabs"
        :key="tab.id"
        :value="tab.id"
        :prepend-icon="tab.name === DEFAULT_TAB_NAME ? 'mdi-lightbulb-on-outline' : 'mdi-tab'"
      >
        <span v-if="!isEditing">{{ tab.name }}</span>
        <input v-else
          class="text-sm outline-none border-b-thin"
          type="text"
          v-model="tab.name"
          @change="updateTabName(tab.id)"
        />
        <div class="absolute right-2">
          <v-icon
            v-if="tab.name !== DEFAULT_TAB_NAME && isEditing"
            @click="tabStore.deleteTab(tab, $event)"
            class="ml-2"
            icon="mdi-close"
          ></v-icon>
          <v-badge
            v-else-if="tab.total > 0"
            :content="tab.total"
            inline
          ></v-badge>
        </div>
      </v-tab>
    </v-tabs>
  </div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import useTabStore, { DEFAULT_TAB_NAME } from '../../../stores/tab.ts'
import { storeToRefs } from 'pinia';

const tabStore = useTabStore()

const { tabs, checked, isEditing } = storeToRefs(tabStore)

onMounted(async () => {
  await tabStore.createDefaultTab()
  await tabStore.queryTabs()
})

function segmentedChange(id: unknown) {
  checked.value = id as number
}

function updateTabName(id: number) {
  tabStore.updateTabName(id)
}
</script>

<style lang="scss" scoped>
.tab-edit{
  outline: none;
}
:deep() {
  .v-tab-item--selected{
    background-color: rgba(#666, .05)
  }
}
</style>