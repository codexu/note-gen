import { createApp } from "vue";
import { createPinia } from 'pinia'
import App from "./App.vue";
import Antd from 'ant-design-vue';
import router from './router'
import './db'
import "./tailwind.css";
import 'ant-design-vue/dist/reset.css';
import './style.scss'

const pinia = createPinia()

createApp(App).use(pinia).use(router).use(Antd).mount("#app");
