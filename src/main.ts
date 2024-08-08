import { createApp } from "vue";
import App from "./App.vue";
import Antd from 'ant-design-vue';
import './db'
import "./tailwind.css";
import 'ant-design-vue/dist/reset.css';

createApp(App).use(Antd).mount("#app");
