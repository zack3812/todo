# TO-DO Panel v1.3.1 发布说明

**发布日期**：2026-09-15

## 本次更新

### 新增：在线升级（Windows）
- 应用内检测新版本，支持一键下载并实时显示下载进度（百分比 / 大小）。
- 下载完成后点击「重启安装」自动完成升级，无需手动下载安装包。
- 设置 → 版本与更新 中可见「下载更新 / 重启安装」按钮与进度条。

### 变更
- macOS 按既有约定（ad-hoc 签名、不公证）保留「检查更新 + 打开下载页」；Windows 走完整自动升级。

### 修复
- 修复 v1.3.0 首次构建 Windows 安装验证失败（冒烟脚本适配删除首页后的界面）。

## 下载

发布在 GitHub Releases：[zack3812/todo](https://github.com/zack3812/todo/releases/latest)

| 平台 | 安装包 | SHA-256 |
| --- | --- | --- |
| macOS (Apple Silicon) | TO-DO-Panel-1.3.1-arm64.dmg | 见 Release 资产 |
| Windows 10/11 x64 | TO-DO-Panel-1.3.1-windows-x64-setup.exe | 见 Release 资产 |

> 首次安装：macOS 需在「系统设置 → 隐私与安全性」允许来自 App Store 和被认可开发者以外的应用；Windows 如出现 SmartScreen 提示，选择「仍要运行」。

## 自动升级说明（Windows）
- 应用启动约 8 秒后自动检查新版本，之后每 6 小时检查一次；也可在设置页手动「检查更新」。
- 发现新版本后点击「下载更新」，进度条显示下载状态；完成后点击「重启安装」自动完成升级。
