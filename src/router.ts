import { createWebHashHistory, createRouter } from 'vue-router'
import BlankLayout from './components/BlankLayout.vue'
import BasicLayout from './components/BasicLayout.vue'
const routes = [
  {
    path: '/',
    component: BasicLayout,
    children: [
      { path: '/', name: 'note', component: () => import('./pages/home/index.vue') },
      { path: '/article', name: 'article', component: () => import('./pages/article/index.vue') },
      { path: '/collection', name: 'collection', component: () => import('./pages/building/index.vue') },
      { path: '/image', name: 'image', component: () => import('./pages/building/index.vue') },
      { path: '/search', name: 'search', component: () => import('./pages/building/index.vue') },
      { path: '/trash', name: 'trash', component: () => import('./pages/building/index.vue') },
      { path: '/history', name: 'history', component: () => import('./pages/building/index.vue') },
      { path: '/platform', name: 'platform', component: () => import('./pages/building/index.vue') },
      { path: '/help', name: 'help', component: () => import('./pages/building/index.vue') },
      { path: '/setting', name: 'setting', component: () => import('./pages/building/index.vue') },
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