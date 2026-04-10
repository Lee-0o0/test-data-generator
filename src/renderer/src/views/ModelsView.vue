<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const list = ref<Array<Record<string, unknown>>>([])
const loading = ref(false)
const dialogVisible = ref(false)
const form = ref({ name: '', description: '' })

const ddlDialogVisible = ref(false)
const ddlText = ref('')
const ddlModelName = ref('')
const ddlSubmitting = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = (await window.tdg.models.list()) as Array<Record<string, unknown>>
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  form.value = { name: '', description: '' }
  dialogVisible.value = true
}

function openDdlImport() {
  ddlText.value = ''
  ddlModelName.value = ''
  ddlDialogVisible.value = true
}

async function submitDdlImport() {
  if (!ddlText.value.trim()) {
    ElMessage.warning('请粘贴 MySQL CREATE TABLE 语句')
    return
  }
  ddlSubmitting.value = true
  try {
    const res = await window.tdg.models.createFromMysqlDdl({
      ddl: ddlText.value,
      modelName: ddlModelName.value.trim() || undefined
    })
    if (!res.ok) {
      ElMessage.error(res.error)
      return
    }
    ddlDialogVisible.value = false
    ElMessage.success('已从 DDL 创建模型')
    await load()
    router.push({ name: 'model-edit', params: { id: String(res.id) } })
  } finally {
    ddlSubmitting.value = false
  }
}

async function submitCreate() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  const { id } = await window.tdg.models.create({
    name: form.value.name.trim(),
    description: form.value.description.trim() || undefined
  })
  dialogVisible.value = false
  ElMessage.success('已创建')
  await load()
  router.push({ name: 'model-edit', params: { id: String(id) } })
}

async function removeRow(row: Record<string, unknown>) {
  await ElMessageBox.confirm('确定删除该模型及其字段？', '确认', { type: 'warning' })
  await window.tdg.models.delete(row.id as number)
  ElMessage.success('已删除')
  await load()
}

async function copyRow(row: Record<string, unknown>) {
  const { id } = await window.tdg.models.copy(row.id as number)
  ElMessage.success('已复制')
  await load()
  router.push({ name: 'model-edit', params: { id: String(id) } })
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="title">数据模型</span>
      <div class="toolbar-actions">
        <el-button type="primary" @click="openCreate">新建模型</el-button>
        <el-button @click="openDdlImport">从 MySQL DDL 导入</el-button>
      </div>
    </div>
    <el-table v-loading="loading" :data="list" stripe style="width: 100%">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="updated_at" label="更新时间" width="180" />
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="router.push(`/models/${row.id}/edit`)">
            编辑字段
          </el-button>
          <el-button link type="primary" @click="copyRow(row)">复制</el-button>
          <el-button link type="danger" @click="removeRow(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="新建模型" width="480px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如 user" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="ddlDialogVisible"
      title="从 MySQL DDL 创建模型"
      width="640px"
      destroy-on-close
      @closed="ddlText = ''"
    >
      <p class="ddl-hint">
        粘贴一条 <code>CREATE TABLE</code> 语句（MySQL 风格）。将解析列名与类型并生成默认生成规则；索引、外键等约束行会被忽略。
      </p>
      <el-form label-width="100px">
        <el-form-item label="模型名称">
          <el-input
            v-model="ddlModelName"
            placeholder="留空则使用 SQL 中的表名"
            clearable
          />
        </el-form-item>
        <el-form-item label="DDL">
          <el-input
            v-model="ddlText"
            type="textarea"
            :rows="14"
            placeholder="CREATE TABLE `user` (&#10;  `id` BIGINT NOT NULL AUTO_INCREMENT,&#10;  `name` VARCHAR(64) NOT NULL,&#10;  `status` ENUM('a','b') DEFAULT 'a',&#10;  PRIMARY KEY (`id`)&#10;) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
            class="ddl-input"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ddlDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="ddlSubmitting" @click="submitDdlImport">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.title {
  font-size: 18px;
  font-weight: 600;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.ddl-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.ddl-hint code {
  font-size: 12px;
  padding: 0 4px;
  background: var(--el-fill-color-light);
  border-radius: 3px;
}
.ddl-input :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
</style>
