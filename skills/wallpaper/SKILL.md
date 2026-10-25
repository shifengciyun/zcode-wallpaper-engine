---
name: wallpaper
description: "管理壁纸（Wallpaper Engine 适配版）：换 Windows 桌面壁纸、换 ZCode 界面背景壁纸（DSH 同款效果）、扫描本地 Wallpaper Engine 创意工坊、随机/必应每日壁纸、可视化画廊挑选。当用户提到壁纸/换壁纸/wallpaper/Wallpaper Engine/桌面背景/界面背景/每日壁纸时使用。"
---

# wallpaper — 桌面壁纸管理

把 DSH 的 dsh-plugin-wallpaper-engine 思路适配到 ZCode：既管理 **Windows 桌面壁纸**，也能把壁纸铺进 **ZCode 界面背后**（DSH 同款效果，通过对 ZCode Desktop 的 app.asar 打可选补丁实现）。

## 脚本位置

所有能力都在一个 PowerShell 脚本里（无管理员权限要求，Windows PowerShell 5.1+ 兼容）：

1. 若环境变量 `ZCODE_PLUGIN_ROOT` 或 `CLAUDE_PLUGIN_ROOT` 已设置：脚本在 `<插件根>/scripts/wallpaper.ps1`。
2. 否则从本 SKILL.md 的基目录推导：本文件位于插件根下 `skills/wallpaper/`，脚本固定在**本目录的上两级**的 `scripts/wallpaper.ps1`。绝不要猜测安装缓存路径。

调用方式（在 Git Bash 中注意引号）：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "<脚本路径>" list
```

脚本永远在 stdout 输出一个**单行 JSON**：`{"ok":true,"command":"...,...}`；失败时 `{"ok":false,"error":"..."}`。先解析 `ok` 字段。

## 子命令

| 命令 | 参数 | 说明 |
|---|---|---|
| `list` | `-Type scene\|web\|video` `-MaxRating Everyone\|Mature` | 扫描所有 Steam 库的 Wallpaper Engine 工坊内容（appid 431960），解析 project.json，返回 id/标题/类型/标签/分级/预览图信息 |
| `thumbs` | `-Thumbs 24 -ThumbWidth 320`（也接受 `-Type`/`-MaxRating`） | 为前 N 个可设置的项目生成 16:9 缩略图到缓存目录，返回 `{id,title,type,contentrating,thumb}` |
| `current` | — | 当前壁纸（注册表 WallpaperPath）、TranscodedWallpaper、正在运行的 WE 进程 |
| `set` | `-WorkshopId <id>` 或 `-Path <图片>`；`-Style cover\|fit\|stretch\|original`；`-Dry`；`-Live` | 设置桌面壁纸。工坊项目自动取预览图（GIF 取首帧转 PNG），按主显示器分辨率合成画布后经 SystemParametersInfo 生效 |
| `random` | 同 `set` 的过滤器；`-Dry`；`-Live` | 随机选一个可设置的项目并设置 |
| `bing` | `-Uhd`；`-Dry` | 下载必应每日壁纸（zh-CN，失败自动回退 cn.bing.com）并设置 |
| `ui` | `-WorkshopId <id>` 或 `-Path <图片>`；`-Scrim 0-100`（默认45，暗化叠层保证文字可读）；`-Dry` | **换 ZCode 界面壁纸**：合成到主显示器分辨率并写入 `~\.zcode\cli\wallpaper\current.jpg`。返回 `patchApplied` 与 `nextStep` |
| `live` | `-WorkshopId <id>` | 尝试用 Wallpaper Engine 主程序 `-control openWallpaper` 起实时壁纸（scene/web/video 真动起来） |

`-Dry` 只做解析/下载并返回将要发生的事，不真正改桌面。

## 设置（userConfig）

用户可以在 **Settings → Plugin Management → 本插件详情 → Advanced** 里配置默认值。读取顺序：

1. 默认值就在插件清单 `<插件根>/.zcode-plugin/plugin.json` 的 `userConfig` 里（解析出的默认壁纸、风格等）。
2. 用户覆盖值存在 `~/.zcode/cli/config.json` 的 `plugins` 段下、键为插件 id `zcode-wallpaper-engine@dev-dicksuck-682f8aee` 的配置对象里（结构未知时在该对象内按同名键宽松查找：defaultWorkshopId / customImage / defaultStyle / maxRating / gallerySize）。

映射到脚本参数：

| 配置 | 用法 |
|---|---|
| `customImage`（本地图片，优先） | `set -Path "<该文件>"` |
| `defaultWorkshopId` | `set -WorkshopId <id>` |
| `defaultStyle` | 传给 `set`/`random` 的 `-Style` |
| `maxRating` | 传给 `list`/`thumbs`/`random` 的 `-MaxRating` |
| `gallerySize` | 传给 `thumbs` 的 `-Thumbs` |

用户说"换成我设置的壁纸 / 换回默认壁纸"时按上表执行；画廊与随机默认套用 maxRating 和 gallerySize。

## 工作流约定

1. **设壁纸前先 `list` 或 `thumbs`**，把候选展示给用户（标题常含中文/emoji，按 JSON 里的原文展示）。
2. **设置会立即改变用户桌面**：只有当用户明确要换壁纸时才调 `set`/`random`/`bing`；用户说"帮我看看有什么壁纸"时只 list/画廊，不动桌面。
3. 场景类项目多为 `preview.gif`，脚本会自动转首帧 PNG（缓存在 `%TEMP%\zcode-wallpaper-engine`）。
4. **live 模式的现实约束**：若本机 Wallpaper Engine 安装缺少主程序 `wallpaper64.exe/wallpaper32.exe`（精简版常见），`live` 会直接报错——此时如实告知用户实时壁纸不可用，改用静态预览图（`set`）。不要求用户装任何东西。
5. 想每天自动换：告诉用户可以用 ZCode 的定时自动化每天跑一次 `random`（由你在对话里创建 automation，脚本路径用当前解析到的绝对路径）。

## 界面壁纸（ZCode UI 背景，DSH 同款效果）

通过给 ZCode Desktop 的 `app.asar` 注入一个 CSS/JS 补丁，把壁纸铺在聊天界面背后：

- **一次性打补丁**：`ui` 返回 `patchApplied: false` 时，指导用户运行插件源码目录下的 `scripts\patch-ui.ps1`（**必须先完全退出 ZCode**，由用户双击/执行；agent 不要在 ZCode 运行时执行它）。补丁自动备份原版到 `app.asar.zwp-orig`，可用 `scripts\restore-ui.ps1` 还原。
- **换壁纸不用再打补丁**：之后每次 `ui` 只是覆写 `~\.zcode\cli\wallpaper\current.jpg`，用户按 **Ctrl+Alt+R**（补丁注入的快捷键）刷新界面即生效，无需重启。
- **可读性调节**：`-Scrim` 参数控制暗化程度（0-100，默认 45，越大文字越清晰、壁纸越暗）。
- **透明度调节**：改 `patch\tools\inject\zwp-wallpaper.css` 里的 `--zwp-canvas`（画布透明度 0-1，默认 0.55）后重跑 patch-ui.ps1。深浅色主题都适配（用主题 token color-mix）。
- **ZCode 更新后补丁会被覆盖**：更新后界面壁纸消失 → 重跑 `patch-ui.ps1` 即可（幂等，会重新从备份/新原版打）。
- 已在隔离测试实例上验证：壁纸渲染、color-mix 透明层、快捷键脚本、asar 校验全部通过。

## 可视化画廊（用户想"看看/挑一个"时）

1. 运行 `thumbs`（默认 24 张，可选 `-MaxRating Everyone`）。
2. 加载 visualize skill，在会话可视化目录写一个 HTML fragment：卡片网格（编号 + 标题 + 分级徽标），**缩略图用 base64 data URI 内嵌**（CSP 不允许本地 file:// 图片）。注意 fragment 上限 1MB：24 张 320px/72质量的 JPEG 约 300KB，安全；不够就减少 `-Thumbs` 或 `-ThumbWidth 240`。
3. 结尾输出 `::visualize{"path":"<绝对路径>/<标题>.html"}`，并请用户回复编号来设置对应壁纸（例如"换第 3 个"）。
4. 用户报编号后，按 JSON 返回的 id 调 `set -WorkshopId <id>`；用户想要"铺在 ZCode 界面里"则调 `ui -WorkshopId <id>`。

## 来源

能力改编自 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（MIT，作者 elysia395 及其维护分支）：那个插件把 Wallpaper Engine 内容实时渲染在 DSH 聊天界面背后；本插件把同一份本地工坊内容接到 Windows 桌面壁纸与 agent 工作流上。

## 壁纸面板（ZCode 内置 UI，v0.4.0）

ZCode 界面右下角有 🖼 悬浮按钮（Ctrl+Alt+W），打开 DSH 同款的壁纸库面板：类型/分级徽标、搜索与筛选、**点击卡片立即应用**（界面壁纸即时生效；桌面壁纸经 SystemParametersInfo）。随机/必应/明暗调节在面板底部。

- 面板依赖本地服务 `scripts\ui-server.mjs`（127.0.0.1:47613，JSONP 通道，patch-ui.ps1 已设置开机自启；也可运行 `scripts\start-ui-server.bat` 手动启动）
- 服务不可用时面板会提示；agent 也可直接用 wallpaper.ps1 子命令完成同样的事
- 新增工坊壁纸后无需重装插件：面板每次打开都实时重扫；缩略图自动生成并缓存在 `~\.zcode\cli\wallpaper\thumbs`
