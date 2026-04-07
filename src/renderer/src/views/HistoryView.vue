<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref<Array<Record<string, unknown>>>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = (await window.tdg.history.list()) as Array<Record<string, unknown>>
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function remove(id: number) {
  await ElMessageBox.confirm('删除该条历史记录？', '确认', { type: 'warning' })
  await window.tdg.history.delete(id)
  ElMessage.success('已删除')
  await load()
}

function copyPath(p: string) {
  navigator.clipboard.writeText(p)
  ElMessage.success('路径已复制')
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="title">历史记录</span>
      <el-button @click="load">刷新</el-button>
    </div>
    <p class="hint">仅保存导出文件路径；若文件被移动或删除，需自行处理。</p>
    <el-table v-loading="loading" :data="list" stripe border>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="model_name" label="模型" width="120" />
      <el-table-column prop="row_count" label="行数" width="80" />
      <el-table-column prop="export_format" label="格式" width="96" />
      <el-table-column prop="duration_ms" label="耗时(ms)" width="100" />
      <el-table-column prop="created_at" label="时间" width="180" />
      <el-table-column label="文件路径" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.file_path || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.file_path"
            link
            type="primary"
            @click="copyPath(String(row.file_path))"
          >
            复制路径
          </el-button>
          <el-button link type="danger" @click="remove(row.id as number)">删除</el-button>
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
}
.title {
  font-size: 18px;
  font-weight: 600;
}
.hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 0 0 12px;
}
</style>
