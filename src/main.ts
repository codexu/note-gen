import { createApp } from "vue";
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { directive as viewer } from "v-viewer"
import App from "./App.vue";
import router from './router'
import './db'
import "./tailwind.css";
import 'vuetify/styles'
import './style.scss'
import 'viewerjs/dist/viewer.css'
import '@mdi/font/css/materialdesignicons.css'

const pinia = createPinia()

const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
    },
  },
  components,
  directives,
})

const imageViewerDirective = viewer()

createApp(App)
  .use(pinia)
  .use(router)
  .use(vuetify)
  .directive("viewer", imageViewerDirective)
  .mount("#app");
