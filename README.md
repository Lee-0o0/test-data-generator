# Test Data Generator

本地测试数据生成器：Electron + Vue 3 + Element Plus + **sql.js**（SQLite WASM，无需 node-gyp）。

## 开发

```bash
npm install
npm run dev
```

若提示 `Electron uninstall`，先确保本机 **7897** 端口代理已开启，再执行 `npm run electron:install` 或重新 `npm install`。

### Electron 下载很慢 / `ReadError: The server aborted pending request`

默认会从 **GitHub** 拉包；终端里的 Node **不会自动用系统代理**。本项目在 `package.json` 的 `electron:install` / `postinstall` 里已通过 `cross-env` 设置：

- `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（国内镜像，避免 npm 弃用的 `.npmrc` 里的 `electron_mirror` 配置）
- `HTTP_PROXY` / `HTTPS_PROXY` → `http://127.0.0.1:7897`

若你改用其它端口，请改 `package.json` 里 `electron:install` 中的地址后执行：

```bash
npm run electron:install
```

下载中断时可清缓存再试（CMD）：

```bat
rmdir /s /q "%LOCALAPPDATA%\electron\Cache" 2>nul
npm run electron:install
```

## 构建

```bash
npm run build
```

安装包构建（需已 `npm run build`）：

```bash
npx electron-builder
```

## 约束（当前版本）

- 单次生成最多 **1000** 行。
- 历史记录仅保存导出文件的**路径**。
- 默认导出 **CSV**；AI 规则：未配置 `OPENAI_API_KEY` 时使用内置启发式映射。

## AI（可选）

在主进程可读到的环境中设置：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（可选，兼容 OpenAI 协议的网关）
- `OPENAI_MODEL`（可选，默认 `gpt-4o-mini`）

打包后需在应用启动前注入环境变量，或后续再接 UI 配置。

## 数据文件

SQLite 数据库位于各系统 Electron `userData` 目录下的 `test-data-generator.db`。
