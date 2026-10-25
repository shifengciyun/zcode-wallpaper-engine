# zcode-wallpaper-engine

把 [Wallpaper Engine](https://www.wallpaperengine.io/) 的壁纸带进 [ZCode Desktop](https://zcode.z.ai)：壁纸铺在聊天界面背后（DSH 同款液态玻璃观感）、场景实时渲染、可视化壁纸面板，同时也能管理 Windows 桌面壁纸。改编自 DSH 的 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT）。

> ⚠️ 原理说明：ZCode Desktop 没有官方背景/主题接口，本工具通过给 `app.asar` 注入两张静态资源文件（CSS/JS + WebWallGL 渲染引擎）实现。**自动备份原版、一键还原**；ZCode 自动更新后补丁会被覆盖，重跑一次补丁即可。仅建议懂原理的用户使用。

## 效果

- **界面壁纸**：任意 Wallpaper Engine 工坊/本地壁纸铺在 ZCode 整窗背后，深蓝液态玻璃（DSH 同款 #0d1524），文字带投影保证可读
- **场景实时渲染**：场景类壁纸由 [WebWallGL](https://github.com/oneincase/webwallgl)（MIT，与 DSH 插件同源引擎）实时渲染——视差、粒子、光影都在动；视频类直接播放 mp4
- **壁纸面板**：右下角 🖼 按钮（Ctrl+Alt+W）打开壁纸库：缩略图网格、类型/分级徽标、搜索筛选、分页，**点击卡片立即应用**，还有随机/必应每日/明暗调节
- **桌面壁纸**：同一面板也能管理 Windows 桌面壁纸（含必应每日 UHD、随机、Wallpaper Engine 实时壁纸控制）

## 安装

前提：Windows + ZCode Desktop + [Node.js](https://nodejs.org)（打补丁时需要；Wallpaper Engine 可选但推荐）。

1. 下载本仓库（Code → Download ZIP），解压到任意目录
2. **完全退出 ZCode**（包括托盘）
3. 双击 `apply-ui-patch.bat` → Y（关闭 ZCode）→ 自动打补丁 → Y（重启 ZCode）
4. ZCode 重开后：右下角 🖼 打开壁纸面板选一张，壁纸即铺在界面背后

补丁器会从**你本机的 app.asar** 现场构建（版本自动匹配，无需联网），自动备份原版到 `app.asar.zwp-orig`，并设置本地服务开机自启。

## 使用

| 操作 | 方式 |
|---|---|
| 换壁纸 | 🖼 面板点击卡片（场景→实时渲染，视频→播放） |
| 打开/关闭面板 | 右下角 🖼 或 Ctrl+Alt+W |
| 刷新界面（换图后未生效） | Ctrl+Alt+R |
| 明暗调节 | 面板底部"暗一点/亮一点" |
| 关闭界面壁纸 | 面板第一张"✕ 关闭"卡片 |
| 新订阅的 WE 壁纸 | 打开面板自动出现 |
| 还原 ZCode 原版 | 运行 `scripts\restore-ui.ps1`（先退出 ZCode） |
| ZCode 更新后 | 重跑一次 `apply-ui-patch.bat` |

## 目录结构

```
apply-ui-patch.bat        一键应用补丁（自动关/重启 ZCode）
.zcode-plugin/plugin.json ZCode 插件清单（含 /wallpaper 命令与技能）
scripts/
  wallpaper.ps1           核心能力：扫描工坊/本地库、设桌面/界面壁纸、必应、实时控制
  ui-server.mjs           本地服务 127.0.0.1:47613（面板后端：库/缩略图/场景包/动态层）
  patch-ui.ps1            补丁器（从本机 asar 现场构建，含备份与自动更新防护）
  restore-ui.ps1          一键还原
  start-ui-server.bat     手动启动本地服务（正常由开机自启拉起）
patch/tools/
  apply.mjs               asar 注入实现（内置 @electron/asar，离线）
  inject/                 注入资源：zwp-wallpaper.css/.js + webwallgl 引擎
```

## 已知边界

- 场景实时渲染依赖 WebWallGL，个别复杂场景（特殊着色器）效果可能与 Wallpaper Engine 客户端有差异，渲染失败自动回退高清静态图
- 界面壁纸功能依赖 app.asar 补丁；ZCode 官方更新会覆盖补丁（本工具会禁用自动更新防止静默覆盖，需要更新时先还原再更新）
- 仅支持 Windows（桌面壁纸 API 与补丁流程均为 Windows 实现）
- Wallpaper Engine 壁纸版权归各自作者，请通过 Steam 正版获取

## 致谢

- [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT）— 概念与产品形态
- [WebWallGL](https://github.com/oneincase/webwallgl)（MIT）— 场景实时渲染引擎
- Wallpaper Engine 及其创意工坊的全体创作者

## License

MIT — 见 [LICENSE](LICENSE)
