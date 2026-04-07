import { createRouter, createWebHashHistory } from 'vue-router'
import ModelsView from '../views/ModelsView.vue'
import ModelEditView from '../views/ModelEditView.vue'
import GenerateView from '../views/GenerateView.vue'
import HistoryView from '../views/HistoryView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/models' },
    { path: '/models', name: 'models', component: ModelsView },
    { path: '/models/:id/edit', name: 'model-edit', component: ModelEditView },
    { path: '/generate', name: 'generate', component: GenerateView },
    { path: '/history', name: 'history', component: HistoryView },
    { path: '/settings', name: 'settings', component: SettingsView }
  ]
})

export default router
