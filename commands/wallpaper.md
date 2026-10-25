---
description: 浏览并更换桌面壁纸（Wallpaper Engine 工坊内容 / 本地图片 / 必应每日）
argument-hint: "[想换的壁纸描述或留空看画廊]"
---

用户想管理桌面壁纸。按 wallpaper skill 的约定操作，先读取插件的 userConfig（默认壁纸、填充方式、分级上限、画廊数量）作为缺省参数：

1. 若用户给了明确目标（某个 Wallpaper Engine 项目、关键词、本地图片路径、或提到"每日/必应"）：直接按语义执行（`list` 找匹配 → 向用户确认标题 → `set`）。
2. 若用户没有具体目标（$ARGUMENTS 为空）：运行 `thumbs`（张数取 gallerySize、过滤取 maxRating）生成缩略图，按 visualize skill 生成画廊 fragment（base64 内嵌缩略图，卡片带编号、标题、分级），让用户回复编号后再 `set -WorkshopId`。
3. 用户说"换成我设置的壁纸"时：优先用 userConfig 里的 `customImage`（本地图片），否则用 `defaultWorkshopId`。
4. 设置动作前把将要应用的壁纸标题告诉用户；`set` 之后用一句话报告结果（应用了哪个文件、什么风格）。

$ARGUMENTS
