import { createMemoryHistory, createRouter } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./pages/home/index.vue') },
  { path: '/note', name: 'note', component: () => import('./pages/note/index.vue') },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes,
})

export default router