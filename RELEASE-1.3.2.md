# Release v1.3.2 — 国内镜像加速更新

## 版本信息
- 版本：v1.3.2
- 发布日期：2026-09-15
- 仓库：github.com/zack3812/todo

## 变更摘要
1. **多更新源自动选择**：GitHub 直连 + 国内加速镜像（gh-proxy / ghfast）并行探测，自动选最快可达源；GitHub 不通自动切镜像。
2. **下载失败自动换源重试**：从当前源下载失败时按顺序尝试其他可达源。
3. **修复**：检查失败时版本号显示 "v"；「检查中」误报失败。

## 构建产物（构建完成后填入 SHA-256）

| 平台 | 安装包 | SHA-256 |
| --- | --- | --- |
| macOS (Apple Silicon) | TO-DO-Panel-1.3.2-arm64.dmg | 待构建完成后填入 |
| Windows 10/11 x64 | TO-DO-Panel-1.3.2-windows-x64-setup.exe | 待构建完成后填入 |

## 自动升级 feed
- latest.yml 已随 Release 发布；客户端运行时探测 GitHub 与镜像源，自动选源下载。
