<template>
  <div class="flex justify-between">
    <MainMenu />
      <router-view></router-view>
  </div>
</template>

<script lang="ts" setup>
import MainMenu from './MainMenu.vue';
</script>

<style lang="scss" scoped>

</style>
