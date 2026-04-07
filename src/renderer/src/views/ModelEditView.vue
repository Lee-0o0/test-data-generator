<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const modelId = computed(() => Number(route.params.id))

const model = ref<Record<string, unknown> | null>(null)
const fields = ref<
  Array<{
    field_name: string
    field_type: string
    required: boolean
    rule_expr: string
    sample_value: string
    remark: string
    sort_order: number
  }>
>([])
const loading = ref(false)

/** 字段类型（元数据）；实际生成由「生成规则」表达式决定 */
const typeOptions = [
  { label: 'string 文本', value: 'string' },
  { label: 'int 整数', value: 'int' },
  { label: 'decimal 小数', value: 'decimal' },
  { label: 'date 日期', value: 'date' },
  { label: 'datetime 日期时间', value: 'datetime' },
  { label: 'timestamp 时间戳', value: 'timestamp' },
  { label: 'bool 布尔', value: 'bool' },
  { label: 'phone 手机', value: 'phone' },
  { label: 'email 邮箱', value: 'email' },
  { label: 'uuid', value: 'uuid' },
  { label: 'enum 枚举', value: 'enum' },
  { label: 'name 姓名', value: 'name' },
  { label: 'address 地址', value: 'address' },
  { label: 'regex 正则生成', value: 'regex' },
  { label: 'fixed 固定值', value: 'fixed' },
  { label: 'increment 自增', value: 'increment' }
]

async function load() {
  if (!modelId.value || Number.isNaN(modelId.value)) {
    router.push('/models')
    return
  }
  loading.value = true
  try {
    model.value = (await window.tdg.models.get(modelId.value)) as Record<string, unknown> | null
    if (!model.value) {
      ElMessage.error('模型不存在')
      router.push('/models')
      return
    }
    const raw = (await window.tdg.fields.list(modelId.value)) as Array<Record<string, unknown>>
    fields.value = raw.map((r, i) => ({
      field_name: String(r.field_name ?? ''),
      field_type: String(r.field_type ?? 'string'),
      required: Boolean(r.required),
      rule_expr: String(r.rule_expr ?? 'string(8)'),
      sample_value: String(r.sample_value ?? ''),
      remark: String(r.remark ?? ''),
      sort_order: Number(r.sort_order ?? i)
    }))
  } finally {
    loading.value = false
  }
}

watch(
  () => route.params.id,
  () => load(),
  { immediate: true }
)

function addField() {
  fields.value.push({
    field_name: `field_${fields.value.length + 1}`,
    field_type: 'string',
    required: true,
    rule_expr: 'string(8)',
    sample_value: '',
    remark: '',
    sort_order: fields.value.length
  })
}

function removeField(index: number) {
  fields.value.splice(index, 1)
  fields.value.forEach((f, i) => (f.sort_order = i))
}

async function save() {
  for (const f of fields.value) {
    if (!f.field_name.trim()) {
      ElMessage.warning('字段名不能为空')
      return
    }
    if (!f.rule_expr.trim()) {
      ElMessage.warning(`字段 ${f.field_name} 的规则不能为空`)
      return
    }
  }
  await window.tdg.fields.save({
    modelId: modelId.value,
    fields: fields.value.map((f, i) => ({
      field_name: f.field_name.trim(),
      field_type: f.field_type,
      required: f.required,
      rule_expr: f.rule_expr.trim(),
      sample_value: f.sample_value || undefined,
      remark: f.remark || undefined,
      sort_order: i
    }))
  })
  ElMessage.success('已保存')
  await load()
}

async function aiSuggest() {
  const names = fields.value.map((f) => f.field_name).filter(Boolean)
  if (names.length === 0) {
    ElMessage.info('请先添加字段')
    return
  }
  const map = await window.tdg.ai.suggestRules(names)
  for (const f of fields.value) {
    const r = map[f.field_name]
    if (r) f.rule_expr = r
  }
  ElMessage.success('已根据字段名更新规则（可再手动调整）')
}
</script>

<template>
  <div v-loading="loading">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push('/models')">← 返回</el-button>
        <span class="title">编辑字段：{{ model?.name }}</span>
      </div>
      <div>
        <el-button @click="addField">添加字段</el-button>
        <el-button @click="aiSuggest">智能推荐规则</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </div>
    </div>
    <p class="hint">
      规则：fixed(abc) · string(8) · int(1,100) · decimal(0,100,2) · name · phone · email · address ·
      date(2020,2025) · timestamp · uuid · enum(A,B,C) · increment · regex(\d{6})
    </p>

    <el-table :data="fields" border stripe>
      <el-table-column label="#" width="50" type="index" />
      <el-table-column label="字段名" min-width="120">
        <template #default="{ row }">
          <el-input v-model="row.field_name" placeholder="username" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="168">
        <template #default="{ row }">
          <el-select v-model="row.field_type" style="width: 100%">
            <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="必填" width="70" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.required" />
        </template>
      </el-table-column>
      <el-table-column label="生成规则" min-width="160">
        <template #default="{ row }">
          <el-input v-model="row.rule_expr" placeholder="phone" />
        </template>
      </el-table-column>
      <el-table-column label="示例值" min-width="100">
        <template #default="{ row }">
          <el-input v-model="row.sample_value" />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="100">
        <template #default="{ row }">
          <el-input v-model="row.remark" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeField($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
}
.title {
  margin-left: 8px;
  font-size: 16px;
  font-weight: 600;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 0 0 12px;
}
</style>
