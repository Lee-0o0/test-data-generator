<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'

const maxRows = ref(1000)
const models = ref<Array<Record<string, unknown>>>([])
const modelId = ref<number | null>(null)
const count = ref(10)
const seed = ref('')
const loading = ref(false)
const previewRows = ref<Record<string, string | number>[]>([])
const previewFields = ref<Array<{ field_name: string }>>([])

const selectedModel = computed(() => models.value.find((m) => m.id === modelId.value))

onMounted(async () => {
  maxRows.value = await window.tdg.app.maxRows()
  models.value = (await window.tdg.models.list()) as Array<Record<string, unknown>>
  if (models.value.length && modelId.value == null) {
    modelId.value = models.value[0]!.id as number
  }
})

watch(modelId, () => {
  previewRows.value = []
  previewFields.value = []
})

async function runPreview() {
  if (modelId.value == null) {
    ElMessage.warning('请选择模型')
    return
  }
  const c = Math.min(maxRows.value, Math.max(1, Math.floor(count.value)))
  count.value = c
  loading.value = true
  try {
    const res = await window.tdg.generate.preview({
      modelId: modelId.value,
      count: c,
      seed: seed.value.trim() || undefined
    })
    previewFields.value = (res.fields as Array<{ field_name: string }>).map((f) => ({
      field_name: f.field_name
    }))
    previewRows.value = res.rows
    ElMessage.success(`已生成 ${res.rows.length} 行预览`)
  } finally {
    loading.value = false
  }
}

type ExportKind = 'csv' | 'json' | 'mysql'

async function runExport(kind: ExportKind) {
  if (modelId.value == null || !selectedModel.value) {
    ElMessage.warning('请选择模型')
    return
  }
  const c = Math.min(maxRows.value, Math.max(1, Math.floor(count.value)))
  count.value = c
  const payload = {
    modelId: modelId.value,
    count: c,
    seed: seed.value.trim() || undefined,
    modelName: String(selectedModel.value.name)
  }
  const res =
    kind === 'csv'
      ? await window.tdg.export.csv(payload)
      : kind === 'json'
        ? await window.tdg.export.json(payload)
        : await window.tdg.export.mysql(payload)
  if (!res.ok) {
    if (res.reason !== 'cancelled') ElMessage.warning('导出取消')
    return
  }
  ElMessage.success(`已导出 ${res.rowCount} 行，耗时 ${res.durationMs} ms`)
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="title">生成与导出</span>
    </div>
    <el-form label-width="100px" class="form">
      <el-form-item label="数据模型">
        <el-select v-model="modelId" placeholder="选择模型" style="width: 280px" filterable>
          <el-option
            v-for="m in models"
            :key="m.id as number"
            :label="`${m.name} (#${m.id})`"
            :value="m.id as number"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="生成数量">
        <el-input-number v-model="count" :min="1" :max="maxRows" />
        <span class="tip">最多 {{ maxRows }} 行</span>
      </el-form-item>
      <el-form-item label="随机种子">
        <el-input v-model="seed" placeholder="可选，相同种子可复现" style="max-width: 320px" clearable />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="runPreview">生成预览</el-button>
        <el-button type="success" @click="runExport('csv')">导出 CSV</el-button>
        <el-button @click="runExport('json')">导出 JSON</el-button>
        <el-button @click="runExport('mysql')">导出 MySQL SQL</el-button>
      </el-form-item>
    </el-form>

    <div v-if="previewRows.length" class="preview-wrap">
      <div class="preview-title">预览（{{ previewRows.length }} 行）</div>
      <el-table :data="previewRows" stripe max-height="480" border>
        <el-table-column
          v-for="col in previewFields"
          :key="col.field_name"
          :prop="col.field_name"
          :label="col.field_name"
          min-width="120"
          show-overflow-tooltip
        />
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  margin-bottom: 12px;
}
.title {
  font-size: 18px;
  font-weight: 600;
}
.form {
  max-width: 720px;
}
.tip {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.preview-wrap {
  margin-top: 16px;
}
.preview-title {
  margin-bottom: 8px;
  font-weight: 500;
}
</style>
