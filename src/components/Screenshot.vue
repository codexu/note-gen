<script setup lang="ts">
import { invoke } from "@tauri-apps/api/tauri";
import { register } from '@tauri-apps/api/globalShortcut';
import { onMounted } from "vue";
import store from 'store'
import { db } from '../db.ts';
import emitter from '../emitter.ts';

async function screenshot() {
  const screenshotPath = await invoke("screenshot");

  const currentTag = store.get('currentTag')
  db.notes.add({
    imgPath: screenshotPath as string,
    content: screenshotPath as string,
    tag: currentTag,
  })

  emitter.emit('refresh')
}

onMounted(async () => {
  await register('CommandOrControl+Shift+C', () => {
    screenshot();
  });
})
</script>

<style scoped>
.image {
  width: 300px;
}
</style>
