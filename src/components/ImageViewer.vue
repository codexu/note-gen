<template>
  <v-overlay v-model="visible" @click="close" scroll-strategy="close" :opacity="0.7">
    <div class="w-screen h-screen flex justify-center items-center">
      <img class="w-3/4 object-contain" :src="props.src"></img>
    </div>
  </v-overlay>
</template>

<script lang="ts" setup>
const props = defineProps<{
  src: string
}>()

const visible = defineModel('visible', { type: Boolean, default: false })

function close() {
  visible.value = false
}
</script>
