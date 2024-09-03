import { createWebHashHistory, createRouter } from 'vue-router'
import BlankLayout from './components/BlankLayout.vue'
import BasicLayout from './components/BasicLayout.vue'
const routes = [
  {
    path: '/',
    component: BasicLayout,
    children: [
      { path: '/', name: 'home', component: () => import('./pages/home/index.vue') },
    ]
  },
  {
    path: '/',
    component: BlankLayout,
    children: [
      { path: '/screenshot', name: 'screenshot', component: () => import('./pages/screenshot/index.vue') },
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router