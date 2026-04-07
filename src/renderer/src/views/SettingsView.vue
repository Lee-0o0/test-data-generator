<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

type AppSettings = {
  https_proxy: string
  gemini_api_key: string
  gemini_model: string
  openrouter_api_key: string
  openrouter_model: string
  kimi_api_key: string
  kimi_model: string
  ai_suggest_provider: string
}

const loading = ref(false)
const saving = ref(false)

const form = reactive<AppSettings>({
  https_proxy: '',
  gemini_api_key: '',
  gemini_model: 'gemini-flash-latest',
  openrouter_api_key: '',
  openrouter_model: 'qwen/qwen3.6-plus:free',
  kimi_api_key: '',
  kimi_model: 'moonshot-v1-8k',
  ai_suggest_provider: 'auto'
})

const aiSuggestOptions = [
  {
    label: '自动：Gemini → OpenRouter → Kimi（按 Key 是否存在跳过）',
    value: 'auto'
  },
  {
    label: 'OpenRouter 优先：OpenRouter → Gemini → Kimi',
    value: 'openrouter_first'
  },
  { label: 'Kimi 优先：Kimi → Gemini → OpenRouter', value: 'kimi_first' },
  { label: '仅 Gemini', value: 'gemini_only' },
  { label: '仅 OpenRouter', value: 'openrouter_only' },
  { label: '仅 Kimi（Moonshot）', value: 'kimi_only' }
]

const geminiModelOptions = [
  { label: 'gemini-flash-latest', value: 'gemini-flash-latest' },
  { label: 'gemini-2.0-flash', value: 'gemini-2.0-flash' },
  { label: 'gemini-1.5-flash', value: 'gemini-1.5-flash' },
  { label: 'gemini-1.5-pro', value: 'gemini-1.5-pro' }
]

const openrouterFreeModels = [
  {
    label: 'openrouter/free（自动选可用免费模型）',
    value: 'openrouter/free'
  },
  { label: 'Qwen3.6 Plus（免费）', value: 'qwen/qwen3.6-plus:free' },
  { label: 'Qwen3 Coder（免费）', value: 'qwen/qwen3-coder:free' },
  { label: 'Step 3.5 Flash（免费）', value: 'stepfun/step-3.5-flash:free' },
  {
    label: 'NVIDIA Nemotron 3 Super 120B（免费）',
    value: 'nvidia/nemotron-3-super-120b-a12b:free'
  },
  {
    label: 'NVIDIA Nemotron 3 Nano 30B（免费）',
    value: 'nvidia/nemotron-3-nano-30b-a3b:free'
  },
  { label: 'MiniMax M2.5（免费）', value: 'minimax/minimax-m2.5:free' },
  { label: 'Arcee Trinity Mini（免费）', value: 'arcee-ai/trinity-mini:free' },
  { label: 'Z.ai GLM 4.5 Air（免费）', value: 'z-ai/glm-4.5-air:free' }
]

const openrouterPaidModels = [
  { label: 'openai/gpt-4o-mini', value: 'openai/gpt-4o-mini' },
  { label: 'openai/gpt-4o', value: 'openai/gpt-4o' },
  { label: 'anthropic/claude-3.5-sonnet', value: 'anthropic/claude-3.5-sonnet' },
  { label: 'google/gemini-flash-1.5', value: 'google/gemini-flash-1.5' },
  { label: 'deepseek/deepseek-chat', value: 'deepseek/deepseek-chat' },
  { label: 'meta-llama/llama-3.3-70b-instruct', value: 'meta-llama/llama-3.3-70b-instruct' }
]

const kimiModelOptions = [
  { label: 'moonshot-v1-8k', value: 'moonshot-v1-8k' },
  { label: 'moonshot-v1-32k', value: 'moonshot-v1-32k' },
  { label: 'moonshot-v1-128k', value: 'moonshot-v1-128k' },
  { label: 'kimi-k2-0711-preview', value: 'kimi-k2-0711-preview' }
]

async function load(): Promise<void> {
  loading.value = true
  try {
    const s = (await window.tdg.settings.get()) as AppSettings
    Object.assign(form, s)
  } finally {
    loading.value = false
  }
}

void load()

async function onSave(): Promise<void> {
  saving.value = true
  try {
    const res = (await window.tdg.settings.set({ ...form })) as { ok: true } | { ok: false; error?: string }
    if (res && typeof res === 'object' && 'ok' in res && res.ok === false) {
      ElMessage.error(('error' in res && res.error) || '保存失败')
      return
    }
    ElMessage.success('已保存，内存与出站代理已刷新')
    await load()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-loading="loading" class="page-settings">
    <div class="head">
      <h1 class="title">设置</h1>
      <p class="sub">
        API Key 与模型保存在 <code>app_settings</code>；OpenRouter / Kimi 的请求地址已内置，无需填写 URL。主进程始终从内存读取生效配置。
      </p>
    </div>

    <el-form label-position="top" class="form" @submit.prevent>
      <el-card shadow="never">
        <template #header>网络代理</template>
        <el-form-item label="HTTPS 代理（出站）">
          <el-input
            v-model="form.https_proxy"
            placeholder="http://127.0.0.1:7890"
            clearable
          />
          <div class="hint">留空则尝试使用环境变量 GEMINI_HTTPS_PROXY / HTTPS_PROXY</div>
        </el-form-item>
      </el-card>

      <el-card shadow="never" class="card-gap">
        <template #header>智能推荐（多家都配 Key 时的顺序）</template>
        <el-form-item label="策略">
          <el-select v-model="form.ai_suggest_provider" style="width: 100%">
            <el-option
              v-for="o in aiSuggestOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
          <div class="hint">只填写一家 Key 时只会调用那一家；失败会按策略尝试下一家（「仅 ××」模式不会切换）。</div>
        </el-form-item>
      </el-card>

      <el-card shadow="never" class="card-gap">
        <template #header>Google Gemini</template>
        <el-form-item label="API Key">
          <el-input
            v-model="form.gemini_api_key"
            type="password"
            show-password
            placeholder="AIza..."
            clearable
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="form.gemini_model"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型 ID"
            style="width: 100%"
          >
            <el-option
              v-for="o in geminiModelOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
      </el-card>

      <el-card shadow="never" class="card-gap">
        <template #header>OpenRouter</template>
        <p class="card-desc">
          固定接口 <code>https://openrouter.ai/api/v1</code>；请求会附带
          <code>reasoning: { enabled: true }</code>（与 OpenRouter 文档/curl 一致）。仅需 Key 与模型。
        </p>
        <el-form-item label="API Key">
          <el-input
            v-model="form.openrouter_api_key"
            type="password"
            show-password
            placeholder="sk-or-v1..."
            clearable
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="form.openrouter_model"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入 OpenRouter 模型名（:free 为免费额度）"
            style="width: 100%"
          >
            <el-option-group label="免费 / 路由器">
              <el-option
                v-for="o in openrouterFreeModels"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-option-group>
            <el-option-group label="计费（常见）">
              <el-option
                v-for="o in openrouterPaidModels"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-card>

      <el-card shadow="never" class="card-gap">
        <template #header>Kimi（Moonshot）</template>
        <p class="card-desc">固定接口 <code>https://api.moonshot.cn/v1</code>，使用 Moonshot 控制台发放的 API Key。</p>
        <el-form-item label="API Key">
          <el-input
            v-model="form.kimi_api_key"
            type="password"
            show-password
            placeholder="sk-..."
            clearable
            autocomplete="off"
          />
        </el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="form.kimi_model"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型名"
            style="width: 100%"
          >
            <el-option
              v-for="o in kimiModelOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
      </el-card>

      <div class="actions">
        <el-button type="primary" :loading="saving" @click="onSave">保存设置</el-button>
        <el-button :disabled="loading" @click="load">重新加载</el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.page-settings {
  max-width: 720px;
}
.head {
  margin-bottom: 20px;
}
.title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
}
.sub {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  line-height: 1.55;
}
.sub code {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.card-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.card-desc code {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.card-gap {
  margin-top: 16px;
}
.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
.actions {
  margin-top: 20px;
  display: flex;
  gap: 12px;
}
</style>
