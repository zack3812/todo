# TO-DO Panel v1.3.2 发布说明

**发布日期**：2026-09-15

## 本次更新

### 新增：国内镜像加速下载
- 检查更新时自动探测 GitHub 直连与国内加速镜像（gh-proxy / ghfast），选最快可达的下载源。
- GitHub 不通时自动使用镜像下载，下载失败自动换源重试，国内环境不再卡在「检查更新失败」。
- 检查更新时显示当前使用的更新源名称。

### 修复
- 检查更新失败时版本号错误显示为 "v"。
- 「检查中」状态误显示「检查更新失败」。

## 下载

发布在 GitHub Releases：[zack3812/todo](https://github.com/zack3812/todo/releases/latest)

| 平台 | 安装包 | SHA-256 |
| --- | --- | --- |
| macOS (Apple Silicon) | TO-DO-Panel-1.3.2-arm64.dmg | 见 Release 资产 |
| Windows 10/11 x64 | TO-DO-Panel-1.3.2-windows-x64-setup.exe | 见 Release 资产 |

> 首次安装：macOS 需在「系统设置 → 隐私与安全性」允许；Windows 如出现 SmartScreen 提示，选择「仍要运行」。

## 自动升级说明（Windows）
- 应用启动约 8 秒后自动检查新版本，之后每 6 小时检查一次；也可在设置页手动「检查更新」。
- 国内网络会自动使用镜像源下载，进度条显示下载状态；完成后点击「重启安装」自动完成升级。
