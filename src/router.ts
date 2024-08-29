import { createWebHashHistory, createRouter } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./pages/home/index.vue') },
  { path: '/note', name: 'note', component: () => import('./pages/note/index.vue') },
  { path: '/screenshot', name: 'screenshot', component: () => import('./pages/screenshot/index.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router