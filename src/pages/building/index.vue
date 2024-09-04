<template>
  <main class="flex-1 flex justify-center items-center">
    <v-empty-state icon="mdi-hazard-lights">
      <template v-slot:headline>
        <div class="text-h4">
          一个建设中的功能
        </div>
      </template>
      <template v-slot:title>
        <div class="text-h6">
          敬请期待
        </div>
      </template>
      <template v-slot:text>
        <div class="text-medium-emphasis text-caption">
          贡献代码: https://github.com/codexu/note-gen
        </div>
      </template>
    </v-empty-state>
  </main>
</template>

<script lang="ts" setup>

</script>

<style lang="scss" scoped>

</style>
