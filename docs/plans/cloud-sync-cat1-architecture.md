# TO-DO-Panel 扩展架构设计：钉钉同步 + Cat.1 模组 + 邮件 AI

> 文档创建：2026-09-14
> 状态：规划阶段
> 范围：待办系统的云端同步、硬件终端扩展、邮件 AI 整合

## 一、扩展愿景

TO-DO-Panel 从纯本地桌面刘海工作台，扩展为**多端协同的 AI 效率中枢**：

```
桌面端（TO-DO-Panel）──┐
                        ├── Cloudflare Worker 中枢 ── 钉钉待办
Cat.1 硬件终端 ─────────┘         │
                                  └── 邮件 AI 整理（后期）
```

核心能力：
- 待办在桌面端、Cat.1 模组、钉钉三方**双向实时同步**
- Cat.1 模组带屏幕显示待办列表 + 声音提醒
- 后期接入邮件 AI 自动整理

---

## 二、整体架构

```
┌──────────────┐     WebSocket      ┌──────────────────┐     MQTT      ┌─────────────┐
│ TO-DO-Panel  │ ◄────────────────► │ Cloudflare Worker│ ◄───────────► │  Cat.1 模组  │
│  （桌面端）   │                    │   （事件中枢）    │               │（带屏+声音） │
└──────────────┘                    └────────┬─────────┘               └─────────────┘
                                             │
                              钉钉 API（创建/更新）│ 钉钉回调（新增/完成）
                                             │
                                             ▼
                                        ┌─────────┐
                                        │ 钉钉待办  │
                                        └─────────┘
```

### 数据流

| 方向 | 路径 | 实时性 |
|------|------|--------|
| 桌面端 → 钉钉 | 直接调钉钉 API | 即时 |
| 钉钉 → 桌面端 | 钉钉回调 → Worker → WebSocket | 秒级 |
| 桌面端 → Cat.1 | Worker → MQTT 广播 | 秒级 |
| Cat.1 → 桌面端 | MQTT → Worker → WebSocket | 秒级 |
| Cat.1 → 钉钉 | MQTT → Worker → 钉钉 API | 即时 |
| 钉钉 → Cat.1 | 钉钉回调 → Worker → MQTT | 秒级 |

---

## 三、Cloudflare Worker 中枢设计

### 职责

1. **钉钉回调接收**：验证签名，接收待办新增/更新/删除事件
2. **WebSocket 网关**：桌面端建立长连接，实时推送事件
3. **MQTT 桥接**：连接 MQTT Broker，与 Cat.1 模组双向通信
4. **事件队列**：用 KV/D1 缓存未送达事件，支持离线补偿

### 技术选型

| 组件 | 方案 | 免费额度 |
|------|------|----------|
| 计算 | Cloudflare Workers | 10 万请求/天 |
| 存储 | Cloudflare KV | 10 万读/天，1000 写/天 |
| 数据库（可选） | Cloudflare D1 | 500 万读/天 |
| MQTT Broker | EMQX Cloud / HiveMQ Cloud | 100 连接 |

### MQTT Topic 设计

```
todo/{userId}/sync          # 待办同步广播（创建/更新/删除）
todo/{userId}/sync/ack      # 确认收到
todo/{deviceId}/status      # 设备在线状态（online/offline）
todo/{userId}/request/full  # 请求全量同步（设备上线时）
```

### 事件格式

```json
{
  "event": "todo.create | todo.update | todo.delete | todo.complete",
  "todoId": "本地待办ID",
  "dingtalkTaskId": "钉钉任务ID（可选）",
  "source": "desktop | cat1 | dingtalk",
  "timestamp": 1726300000000,
  "payload": {
    "text": "待办内容",
    "category": "P0",
    "project": "项目名",
    "dueTime": "2026-09-14T23:30:00+08:00",
    "done": false,
    "executorIds": ["钉钉执行者unionId"]
  }
}
```

---

## 四、钉钉待办接入方案

### API 能力

| 能力 | 接口 | 说明 |
|------|------|------|
| 创建工作待办 | `POST /v1.0/todo/users/{unionId}/tasks` | 需 detailUrl，支持 executorIds 指派他人 |
| 创建个人待办 | `POST /v1.0/todo/users/me/personalTasks` | 需用户 OAuth token |
| 查询待办列表 | `GET /v1.0/todo/users/{unionId}/tasks` | 仅能查到 API 创建的待办 |
| 更新/完成 | `PATCH /v1.0/todo/users/{unionId}/tasks/{taskId}` | 更新内容或标记完成 |
| 删除 | `DELETE ...` | 删除待办 |

### 关键限制

1. **需要企业内部应用**：AppKey/AppSecret，个人用户需有企业组织
2. **个人待办需 OAuth**：以用户身份创建需登录授权
3. **查询盲区**：查询接口只能查到 API 创建的待办，钉钉客户端手动创建的查不到
4. **调用量**：标准版 1万次/月，专业版 50万次/月
5. **给他人创建**：executorIds 填对方 unionId，对方钉钉待办会收到

### 凭证存储

- AppKey/AppSecret：桌面端用 `safeStorage` 加密存储（同百炼 ASR Key 方案）
- 用户 unionId：设置页配置，或通过钉钉扫码授权获取

---

## 五、Cat.1 模组接入方案

### 硬件特性

- **通信**：4G LTE Cat.1（合宙 Air780E / 移远 EC600N 等）
- **显示**：带屏幕，显示待办列表
- **提醒**：声音提醒（蜂鸣器或扬声器）
- **交互**：按键/触屏创建、完成待办
- **供电**：USB 或电池

### 通信协议：MQTT

选择 MQTT 而非 WebSocket/HTTP 的原因：
- 低流量、低功耗（Cat.1 按流量计费）
- 双向实时，支持 QoS 1（至少一次送达）
- 模组原生支持 AT 指令对接 MQTT，开发简单
- 离线自动重连，遗嘱消息（LWT）上报离线状态

### 模组端功能

1. **待办列表显示**：屏幕展示当前未完成待办，按四象限分类
2. **声音提醒**：待办到期前 1 小时蜂鸣/语音提醒（同桌面端提醒逻辑）
3. **按键操作**：
   - 短按：切换待办/翻页
   - 长按：标记完成
   - 双击：创建新待办（语音输入或预设模板）
4. **离线补偿**：离线时操作存在本地 Flash，上线后通过 `lastSyncTime` 增量同步
5. **状态上报**：上线时发布 `todo/{deviceId}/status` = online，遗嘱 = offline

### 模组端数据存储

- 待办列表：本地 Flash / EEPROM，最多存 N 条（如 50 条）
- 同步时间戳：`lastSyncTime`，上线后增量拉取
- 未确认事件：本地队列，收到 Worker 的 ack 后清除

---

## 六、邮件 AI 整合（后期）

### 规划

- Worker 作为统一事件中枢，扩展邮件事件类型
- 邮件接入方式：IMAP 拉取 / 企业邮箱 API / 钉钉邮件
- AI 整理：调用大模型 API 自动分类、摘要、生成待办
- 生成的待办通过同一套同步机制下发到桌面端和 Cat.1 模组

### 事件扩展

```json
{
  "event": "email.summarized",
  "source": "email-ai",
  "payload": {
    "subject": "邮件主题",
    "summary": "AI 摘要",
    "actionItems": ["生成的待办1", "生成的待办2"],
    "priority": "high | medium | low"
  }
}
```

---

## 七、域名

**已确定：`nexusdesk.dpdns.org`**

- `nexus` = 连接中枢，多端汇聚的核心
- `desk` = 桌面工作台
- 品牌统一：FlowDesk → 最终选定 NexusDesk
- 子域名规划：
  - `api.nexusdesk.dpdns.org` — Cloudflare Worker 网关（钉钉回调 + WebSocket）
  - `nexusdesk.dpdns.org` — 官网（后期）

### 品牌命名体系

```
NexusDesk                ← 品牌名
├── NexusDesk Desktop    ← 桌面端（原 TO-DO-Panel）
├── NexusDesk Mini       ← Cat.1 带屏硬件
├── NexusDesk Cloud      ← Cloudflare Worker 中枢
├── NexusDesk Sync       ← 钉钉/邮件同步模块
└── NexusDesk AI         ← 邮件整理 / 智能摘要
```

---

## 八、分阶段实施路径

### Phase 1：钉钉实时同步（当前可启动）

- [ ] 注册域名，托管到 Cloudflare
- [ ] 部署 Cloudflare Worker（钉钉回调接收 + WebSocket 网关）
- [ ] 钉钉开发者后台创建企业内部应用，配置回调 URL
- [ ] TO-DO-Panel 主进程加 WebSocket 客户端，连接 Worker
- [ ] 待办项加「同步钉钉」开关，创建/完成/删除时调钉钉 API
- [ ] 设置页加钉钉配置区（AppKey/AppSecret/unionId，safeStorage 加密）
- [ ] 凭证用 safeStorage 加密存储

### Phase 2：Cat.1 模组双向同步

- [ ] Worker 加 MQTT 桥接（连接 EMQX Cloud）
- [ ] Cat.1 模组固件开发：MQTT 连接、待办列表显示
- [ ] 模组端声音提醒（到期前 1 小时）
- [ ] 模组端按键操作（完成/创建待办）
- [ ] 离线补偿机制（lastSyncTime 增量同步）
- [ ] 设备在线状态监控

### Phase 3：模组端体验优化

- [ ] 屏幕 UI 优化（四象限布局、字体大小）
- [ ] 语音输入创建待办（模组端麦克风 + ASR）
- [ ] 低功耗模式（屏幕休眠、定时唤醒）
- [ ] OTA 固件升级

### Phase 4：邮件 AI 整理

- [ ] 邮箱接入（IMAP / 企业邮箱 API）
- [ ] AI 摘要与分类（大模型 API）
- [ ] 自动生成待办并同步
- [ ] Worker 事件类型扩展

---

## 九、关键决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 云端中枢 | Cloudflare Worker | 免费额度充足，全球边缘节点，支持 WebSocket |
| 模组通信 | MQTT | 低流量低功耗，模组原生支持，双向实时 |
| MQTT Broker | EMQX Cloud 免费版 | 100 连接够用，免运维 |
| 同步策略 | 事件驱动 + 最终一致 | 离线补偿用 lastSyncTime 增量拉取 |
| 钉钉同步 | 单向推送 + 回调接收 | 查询接口有盲区，不做轮询 |
| 域名 | nexusdesk.dpdns.org | 品牌统一，Nexus=中枢，Desk=工作台 |

---

## 十、风险与待验证项

1. **钉钉回调覆盖范围**：待办新增回调是否包含客户端手动创建的待办，需接入后实测
2. **Cat.1 模组 MQTT 稳定性**：4G 网络波动下的重连和消息补偿需充分测试
3. **钉钉调用量**：多人场景下标准版 1万次/月可能不够，需评估专业版
4. **Worker 出站 TCP**：Cloudflare Worker 连接 MQTT Broker 需用 `connect` API 或 MQTT over WebSocket
5. **离线冲突**：多端离线同时修改同一待办，需定义冲突解决策略（最后写入 wins / 版本号）
