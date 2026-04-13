import { app } from 'electron'
import { dirname, join } from 'path'

/**
 * 可写数据根目录：
 * - 打包后：与主程序 exe 同级的 `data`（便携 / 单目录部署）
 * - 开发时：`process.cwd()` 下的 `data`（一般为项目根目录）
 *
 * 若安装到「Program Files」等需管理员权限的目录，可能无法写入，需以管理员运行或换安装路径。
 */
export function getAppDataDir(): string {
  if (app.isPackaged) {
    return join(dirname(process.execPath), 'data')
  }
  return join(process.cwd(), 'data')
}
