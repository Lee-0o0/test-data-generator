<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <el-config-provider namespace="el">
    <div class="layout">
      <el-container>
        <el-aside width="228px" class="aside">
          <div class="brand">Test Data Generator</div>
          <el-menu router :default-active="$route.path" class="menu">
            <el-menu-item index="/models">数据模型</el-menu-item>
            <el-menu-item index="/generate">生成与导出</el-menu-item>
            <el-menu-item index="/history">历史记录</el-menu-item>
            <el-menu-item index="/settings">设置</el-menu-item>
          </el-menu>
        </el-aside>
        <el-main class="main">
          <RouterView />
        </el-main>
      </el-container>
    </div>
  </el-config-provider>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.layout {
  height: 100vh;
}
.aside {
  border-right: 1px solid var(--el-border-color);
}
.brand {
  padding: 16px;
  font-weight: 600;
  font-size: 15px;
  border-bottom: 1px solid var(--el-border-color);
}
.menu {
  border-right: none;
}
.main {
  padding: 20px 24px;
  background: var(--el-bg-color-page);
  font-size: 15px;
  overflow: auto;
}
</style>
