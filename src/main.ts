import { createApp } from "vue";
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import App from "./App.vue";
import router from './router'
import './db'
import "./tailwind.css";
import 'vuetify/styles'
import './style.scss'
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

createApp(App).use(pinia).use(router).use(vuetify).mount("#app");
