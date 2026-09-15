# Release v1.3.1 — 在线升级（Windows 自动更新）

## 版本信息
- 版本：v1.3.1
- 发布日期：2026-09-15
- 仓库：github.com/zack3812/todo

## 变更摘要
1. **新增在线升级（Windows）**：electron-updater 接入 GitHub Release，检测 → 下载（进度显示）→ 一键重启安装。
2. **设置页升级卡升级**：下载进度条 + 「下载更新 / 重启安装」按钮。
3. **macOS**：按 ad-hoc 签名 + 不公证约定，保留检查 + 引导下载。
4. **修复**：Windows 安装冒烟测试适配无首页界面（修复 v1.3.0 首次构建失败）。

## 构建产物（构建完成后填入 SHA-256）

| 平台 | 安装包 | SHA-256 |
| --- | --- | --- |
| macOS (Apple Silicon) | TO-DO-Panel-1.3.1-arm64.dmg | 待构建完成后填入 |
| Windows 10/11 x64 | TO-DO-Panel-1.3.1-windows-x64-setup.exe | 待构建完成后填入 |

## 自动升级 feed
- latest.yml 已随 Release 发布，Windows 客户端通过 GitHub Releases 自动检查更新。
