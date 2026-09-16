# Release v1.3.3 — macOS 输入法候选框修复

## 版本信息
- 版本：v1.3.3
- 发布日期：2026-09-16
- 仓库：github.com/zack3812/todo

## 变更摘要
1. **修复 macOS 输入法候选框不可见**：创建待办等输入场景时，窗口置顶级别从 screen-saver 降为 floating，系统输入法候选词正常浮出；折叠态保持 screen-saver，折叠条在菜单栏拦截带内仍可点击。
2. **授权协调器按模式恢复置顶**：摄像头 / 麦克风 TCC 授权结束后按当前模式恢复窗口层级，避免展开态被升回 screen-saver 后再次压住输入法候选框。

## 构建产物（构建完成后填入 SHA-256）

| 平台 | 安装包 | SHA-256 |
| --- | --- | --- |
| macOS (Apple Silicon) | TO-DO-Panel-1.3.3-arm64.dmg | 待构建完成后填入 |
| Windows 10/11 x64 | TO-DO-Panel-1.3.3-windows-x64-setup.exe | 待构建完成后填入 |

## 自动升级 feed
- latest.yml 已随 Release 发布；客户端运行时探测 GitHub 与镜像源，自动选源下载。
