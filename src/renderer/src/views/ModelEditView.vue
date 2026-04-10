<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

type FieldRow = {
  field_name: string
  field_type: string
  required: boolean
  rule_expr: string
  sample_value: string
  remark: string
  sort_order: number
  /** 仅前端：规则校验错误文案 */
  ruleError?: string
}

const route = useRoute()
const router = useRouter()
const modelId = computed(() => Number(route.params.id))

const model = ref<Record<string, unknown> | null>(null)
const fields = ref<FieldRow[]>([])
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

type TypePreset = { rule_expr: string; sample_value: string; remark: string }

/** 此类型的生成规则为固定关键字，不允许在界面中修改（需改类型才会重置规则） */
const RULE_LOCKED_FIELD_TYPES = new Set([
  'name',
  'phone',
  'email',
  'address',
  'uuid',
  'increment',
  'timestamp'
])

function isRuleLocked(fieldType: string): boolean {
  return RULE_LOCKED_FIELD_TYPES.has(fieldType)
}

/** 切换类型时同步填充：生成规则、示例值、备注（备注内说明规则写法） */
const TYPE_PRESETS: Record<string, TypePreset> = {
  string: {
    rule_expr: 'SKP+string(8)',
    sample_value: 'SKPx7k2m9n3',
    remark:
      '默认固定前缀 SKP + 随机 8 位字母数字。规则写法：string(固定长度) 如 string(8)；变长 string(最小,最大) 如 string(1,4) 表示随机 1～4 个字符。前缀用英文加号连接，如 ABC+string(6)、SKP+string(1,4)；前缀内不要含 + 与未配对括号。'
  },
  int: {
    rule_expr: 'int(1,100)',
    sample_value: '42',
    remark:
      '闭区间随机整数。规则写法：int(最小值,最大值)，两边界包含在内，例如 int(0,999)、int(-10,10)。'
  },
  decimal: {
    rule_expr: 'decimal(0,100,2)',
    sample_value: '37.85',
    remark:
      '区间内随机小数。规则写法：decimal(最小,最大,小数位数)，第三位为保留小数位，例如 decimal(0,9999.99,2) 常用于金额。'
  },
  date: {
    rule_expr: 'date(2020,2025)',
    sample_value: '2023-08-17',
    remark:
      '合法公历日期，格式 YYYY-MM-DD。规则写法：date(起始年,结束年)，在年份范围内随机月日；闰年、每月天数已处理。'
  },
  datetime: {
    rule_expr: 'datetime(2020,2025)',
    sample_value: '2024-06-15 14:32:08',
    remark:
      '日期+时间，格式 yyyy-MM-dd HH:mm:ss。规则写法：datetime(起始年,结束年)，在年份范围内随机合法日历日及时分秒（00–23 时、00–59 分秒）。若只要日期不要时间请改类型为 date。'
  },
  timestamp: {
    rule_expr: 'timestamp',
    sample_value: '1714521600000',
    remark:
      '毫秒级 Unix 时间戳（数字）。规则写法：固定关键字 timestamp，不要括号或参数。'
  },
  bool: {
    rule_expr: 'enum(true,false)',
    sample_value: 'true',
    remark:
      '布尔可用枚举模拟。规则写法：enum(选项1,选项2,...)，英文逗号分隔；选项不要含未转义的逗号。也可写 enum(是,否)。'
  },
  phone: {
    rule_expr: 'phone',
    sample_value: '13800138000',
    remark:
      '中国大陆 11 位手机号样式。规则写法：固定关键字 phone，无括号。'
  },
  email: {
    rule_expr: 'email',
    sample_value: 'u12345678@mail.com',
    remark:
      '随机邮箱字符串。规则写法：固定关键字 email，无括号。'
  },
  uuid: {
    rule_expr: 'uuid',
    sample_value: '550e8400-e29b-41d4-a716-446655440000',
    remark:
      'UUID 样式（8-4-4-4-12 十六进制）。规则写法：固定关键字 uuid，无括号。'
  },
  enum: {
    rule_expr: 'enum(A,B,C)',
    sample_value: 'B',
    remark:
      '从列表中随机取一项。规则写法：enum(值1,值2,值3)，英文逗号分隔；中文直接写 enum(待支付,已支付,已关闭)。值内不要出现英文逗号。'
  },
  name: {
    rule_expr: 'name',
    sample_value: '张伟',
    remark:
      '随机中文姓名。规则写法：固定关键字 name，无括号。'
  },
  address: {
    rule_expr: 'address',
    sample_value: '北京市朝阳区测试路128号',
    remark:
      '随机地址模板句。规则写法：固定关键字 address，无括号。'
  },
  regex: {
    rule_expr: 'regex(\\d{6})',
    sample_value: '384920',
    remark:
      '按「正则子集」生成。规则写法：regex(模式)，模式支持 . \\d \\w \\s、字符类 []、量词 * + ? 与 {n}、{n,m}。六位数字示例：regex(\\d{6})（输入框里反斜杠按一条 \\ 写即可）。'
  },
  fixed: {
    rule_expr: 'fixed(默认值)',
    sample_value: '默认值',
    remark:
      '整列固定同一值。规则写法：fixed(任意文本)，括号内全部内容原样输出；若文本本身含右括号 )，请避免或改用其它类型。'
  },
  increment: {
    rule_expr: 'increment',
    sample_value: '1',
    remark:
      '按生成行顺序 1、2、3…，每列独立计数。规则写法：固定关键字 increment，无括号。'
  }
}

function applyTypePreset(row: FieldRow, type: string): void {
  const p = TYPE_PRESETS[type]
  if (!p) return
  row.ruleError = ''
  row.rule_expr = p.rule_expr
  row.sample_value = p.sample_value
  row.remark = p.remark
}

async function commitRulePreview(row: FieldRow): Promise<void> {
  const expr = row.rule_expr.trim()
  if (!expr) {
    row.ruleError = '规则有误：不能为空'
    return
  }
  const res = await window.tdg.rule.preview(
    expr,
    row.field_name.trim() || undefined,
    row.field_type
  )
  if (!res.ok) {
    row.ruleError = res.error ?? '规则有误'
    return
  }
  row.ruleError = ''
  row.sample_value = res.preview ?? ''
}

async function onFieldTypeChange(row: FieldRow, newType: string | string[]): Promise<void> {
  const t = Array.isArray(newType) ? String(newType[0] ?? '') : String(newType)
  if (!t) return
  applyTypePreset(row, t)
  await commitRulePreview(row)
}

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
    await Promise.all(fields.value.map((f) => commitRulePreview(f)))
  } finally {
    loading.value = false
  }
}

watch(
  () => route.params.id,
  () => load(),
  { immediate: true }
)

/** 在表格最下方追加一行，并套用当前类型默认规则/示例/备注 */
function addFieldAtBottom(): void {
  const n = fields.value.length + 1
  const row: FieldRow = {
    field_name: `field_${n}`,
    field_type: 'string',
    required: true,
    rule_expr: '',
    sample_value: '',
    remark: '',
    sort_order: fields.value.length
  }
  fields.value.push(row)
  applyTypePreset(row, 'string')
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
  const saveRes = await window.tdg.fields.save({
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
  if (saveRes && typeof saveRes === 'object' && 'ok' in saveRes && saveRes.ok === false) {
    const errs = 'errors' in saveRes && Array.isArray(saveRes.errors) ? saveRes.errors : []
    ElMessage.error(errs.length ? errs.join('；') : '保存失败：存在无效规则')
    for (const f of fields.value) {
      const vr = await window.tdg.rule.preview(
        f.rule_expr.trim(),
        f.field_name.trim() || undefined,
        f.field_type
      )
      f.ruleError = vr.ok ? '' : (vr.error ?? '规则有误')
    }
    return
  }
  ElMessage.success('已保存')
  await load()
}

async function openAiLogFolder(): Promise<void> {
  const r = await window.tdg.ai.openLogFolder()
  if (r.error) {
    ElMessage.warning(`无法打开文件夹：${r.error}`)
    return
  }
  ElMessage.success('已在资源管理器中打开 AI 日志目录')
}

async function aiSuggest() {
  if (fields.value.length === 0) {
    ElMessage.info('请先添加字段')
    return
  }
  const payload = fields.value.map((f) => ({
    field_name: f.field_name.trim(),
    field_type: f.field_type || 'string'
  }))
  if (!payload.some((p) => p.field_name)) {
    ElMessage.info('请至少填写一个字段名后再推荐')
    return
  }
  const map = await window.tdg.ai.suggestRules(payload)
  for (const f of fields.value) {
    const key = f.field_name.trim()
    const entry = map[key]
    if (!entry) continue
    if (entry.field_type) {
      f.field_type = entry.field_type
      applyTypePreset(f, entry.field_type)
    }
    f.rule_expr = entry.rule_expr
  }
  for (const f of fields.value) {
    const key = f.field_name.trim()
    await commitRulePreview(f)
    const again = map[key]
    if (again?.sample_value?.trim()) {
      f.sample_value = again.sample_value.trim()
    }
  }
  ElMessage.success('已根据字段名更新类型、规则与示例（可再手动调整）')
}

</script>

<template>
  <div v-loading="loading" class="page-model-edit">
    <div class="toolbar">
      <div>
        <el-button text @click="router.push('/models')">← 返回</el-button>
        <span class="title">编辑字段：{{ model?.name }}</span>
      </div>
      <div class="toolbar-actions">
        <el-button @click="aiSuggest">智能推荐规则</el-button>
        <el-button @click="openAiLogFolder">打开 AI 日志目录</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </div>
    </div>
    <div class="hint-panel" role="note">
      <p class="hint-panel__title">规则语法速览</p>
      <ul class="hint-panel__list">
        <li>
          基础：<code>fixed(abc)</code>、<code>string(8)</code>、<code>string(1,4)</code>（变长）、<code>int(1,100)</code>、<code>decimal(0,100,2)</code>
        </li>
        <li>
          关键字：<code>name</code>、<code>phone</code>、<code>email</code>、<code>address</code>、<code>uuid</code>、<code>increment</code>、<code>timestamp</code>
        </li>
        <li>
          日期时间：<code>date(2020,2025)</code>、<code>datetime(2020,2025)</code>；枚举：<code>enum(A,B,C)</code>；正则：<code>regex(\d{6})</code>
        </li>
        <li>
          文本前缀拼接：<code>SKP+string(8)</code> 或 <code>SKP+string(1,4)</code>（加号连接，须含
          <code>string</code> 调用）
        </li>
      </ul>
      <p class="hint-panel__foot">
        切换「类型」会同步默认规则、示例与备注；生成规则须与类型一致（不一致会标红提示）。修改规则后按回车或失焦刷新示例；name / phone 等关键字类型下规则不可编辑。
      </p>
    </div>

    <div class="field-table-scroll">
    <div class="field-table-wrap">
    <el-table
      :data="fields"
      border
      stripe
      class="field-table"
      :style="{ width: '100%', minWidth: '1480px' }"
    >
      <el-table-column label="操作" width="72" align="center" fixed="left">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeField($index)">删除</el-button>
        </template>
      </el-table-column>
      <el-table-column label="#" width="48" type="index" />
      <el-table-column label="字段名" min-width="148" width="148">
        <template #default="{ row }">
          <el-input v-model="row.field_name" placeholder="username" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="188">
        <template #default="{ row }">
          <el-select
            v-model="row.field_type"
            style="width: 100%"
            @change="(val) => void onFieldTypeChange(row, val)"
          >
            <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="必填" width="76" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.required" />
        </template>
      </el-table-column>
      <el-table-column label="生成规则" min-width="240" width="280">
        <template #default="{ row }">
          <div class="rule-cell">
            <el-input
              v-model="row.rule_expr"
              placeholder="与所选类型对应；改完按回车刷新示例"
              :disabled="isRuleLocked(row.field_type)"
              :clearable="!isRuleLocked(row.field_type)"
              :class="{ 'rule-expr-input--error': row.ruleError }"
              :title="
                isRuleLocked(row.field_type)
                  ? '该类型规则为固定关键字，不可修改；请切换「类型」以更换规则'
                  : ''
              "
              @update:model-value="row.ruleError = ''"
              @keydown.enter.prevent="() => void commitRulePreview(row)"
              @blur="() => void commitRulePreview(row)"
            />
            <div v-if="row.ruleError" class="rule-expr-error-text">{{ row.ruleError }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="示例值" min-width="160" width="180">
        <template #default="{ row }">
          <el-input v-model="row.sample_value" placeholder="示例" clearable />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="200" width="260">
        <template #default="{ row }">
          <div class="remark-cell">
            <el-input
              v-model="row.remark"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              placeholder="规则填写说明"
              class="remark-textarea"
            />
          </div>
        </template>
      </el-table-column>
    </el-table>
    <div class="table-add-bar">
      <el-button
        type="primary"
        circle
        class="add-btn"
        title="在底部添加一行"
        @click="addFieldAtBottom"
      >
        +
      </el-button>
      <span class="append-hint">点击「+」在列表末尾新增一行字段</span>
    </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.page-model-edit {
  max-width: 100%;
}
.field-table-scroll {
  width: 100%;
  overflow-x: auto;
  padding-bottom: 4px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
}
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.title {
  margin-left: 8px;
  font-size: 18px;
  font-weight: 600;
}
.hint-panel {
  margin: 0 0 16px;
  padding: 12px 14px 10px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.6;
}
.hint-panel__title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.hint-panel__list {
  margin: 0 0 10px;
  padding-left: 1.25em;
}
.hint-panel__list li {
  margin-bottom: 6px;
}
.hint-panel__list li:last-child {
  margin-bottom: 0;
}
.hint-panel__list code {
  font-size: 12px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.hint-panel__foot {
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.55;
}
.field-table-wrap {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  overflow: hidden;
}
.field-table {
  width: 100%;
}
.table-add-bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
}
.add-btn {
  width: 36px;
  height: 36px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
  padding: 0;
  margin-right: 12px;
  flex-shrink: 0;
}
.append-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.remark-cell {
  max-width: 100%;
  padding: 2px 0;
}
.remark-cell :deep(.remark-textarea .el-textarea__inner) {
  max-height: 88px;
  overflow-y: auto;
  resize: none;
  box-sizing: border-box;
}
.rule-cell {
  width: 100%;
}
.rule-expr-error-text {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-color-danger);
}
.rule-expr-input--error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
