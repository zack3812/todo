# NexusDesk Cloud

Cloudflare Worker 云端中枢，负责钉钉回调、WebSocket 网关、MQTT 桥接。

## 架构

```
钉钉事件回调 ──► Worker ──► WebSocket ──► 桌面端 TO-DO-Panel
                     │
                     └──► MQTT ──► Cat.1 模组（Phase 2）
```

## 目录结构

```
cloud/
├── src/
│   ├── index.js       # Worker 入口：HTTP 路由 + WebSocket 网关（转发至 WsHub）
│   ├── ws-hub.js      # WsHub Durable Object：连接 / 广播 / 在线状态
│   ├── dingtalk.js    # 钉钉待办 API 封装
│   ├── events.js      # 事件格式定义（桌面端共享）
│   └── mqtt.js        # MQTT 桥接（Phase 2）
├── schema.sql         # D1 表结构（首次部署时执行一次）
├── wrangler.toml      # Cloudflare Worker 配置（D1 绑定 + DO 枢纽）
└── package.json
```

## 存储

核心数据全部存 Cloudflare D1（SQLite 服务化数据库）：

- `users`：用户账号（工号、姓名、角色、密码哈希）
- `sessions`：登录会话（token、过期时间，7 天）
- `todos`：待办（按 `(employee_id, todo_id)` 主键 UPSERT）

在线状态与 WebSocket 连接由 Durable Object 枢纽（`src/ws-hub.js`，WsHub）统一承载：
连接注册、同用户广播、在线状态（90 秒 TTL）集中在单一实例，跨 isolate 也可靠送达；
不写任何数据库。Worker 通过 `WS_HUB` 绑定（固定实例 `idFromName`）转发升级请求与广播调用。

> 已从 Workers KV 迁移：KV 每日写/列表配额（1,000/日）无法支撑 10 用户量级，
> D1 免费额度为每日 500 万行读取 / 10 万行写入。迁移已于 2026-09 完成，KV 绑定已移除。

## 本地开发

```bash
cd cloud
npm install
npm run dev    # 启动本地开发服务器（wrangler dev）
```

## 部署

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 设置密钥（敏感信息，不写入代码）

```bash
npx wrangler secret put DINGTALK_APP_KEY
npx wrangler secret put DINGTALK_APP_SECRET
npx wrangler secret put DINGTALK_TOKEN       # 事件订阅 EncodingAESKey
# Phase 2:
# npx wrangler secret put MQTT_BROKER_URL
# npx wrangler secret put MQTT_USERNAME
# npx wrangler secret put MQTT_PASSWORD
```

### 3. 创建并初始化 D1 数据库（首次部署时）

```bash
npx wrangler d1 create nexusdesk-db
# 把返回的 database_id 填入 wrangler.toml 的 [[d1_databases]]
npx wrangler d1 execute nexusdesk-db --remote --file=schema.sql
```

### 4. 部署

```bash
npm run deploy
```

部署后会得到 `https://nexusdesk-cloud.<your-subdomain>.workers.dev` 的地址。

### 5. 绑定自定义域名

在 Cloudflare 控制台：
- Workers & Pages → nexusdesk-cloud → Settings → Domains & Routes
- 添加自定义域名 `api.nexusdesk.dpdns.org`

或在 `wrangler.toml` 中配置 routes：
```toml
routes = [{ pattern = "api.nexusdesk.dpdns.org/*", zone_name = "nexusdesk.dpdns.org" }]
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/webhook/dingtalk` | POST | 钉钉事件回调入口 |
| `/ws?token=xxx` | GET (WebSocket) | 桌面端 WebSocket 连接（在线状态在连接/断开时更新） |
| `/api/todo/sync` | POST | 桌面端待办同步（UPSERT 到 D1） |
| `/api/my/todos` | GET | 我的待办列表 |
| `/api/presence` | POST | 在线心跳（兼容旧客户端；仅更新 DO 内存，零 DB 写入） |

## 钉钉配置

1. 在 [钉钉开发者后台](https://open-dev.dingtalk.com/) 创建企业内部应用
2. 申请「待办任务」权限（读 + 写）
3. 事件订阅配置：
   - 回调地址：`https://api.nexusdesk.dpdns.org/webhook/dingtalk`
   - 订阅事件：待办任务新增、待办任务更新、待办任务删除
4. 获取 AppKey / AppSecret，设置为 Worker Secret

## 桌面端对接

桌面端（TO-DO-Panel）启动时建立 WebSocket：

```javascript
const ws = new WebSocket('wss://api.nexusdesk.dpdns.org/ws?token=xxx');
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // 处理钉钉/其他设备同步过来的待办变更
};
// 本地待办变更时上报
ws.send(JSON.stringify({ event: 'todo.update', todoId: 'xxx', ... }));
```

## Phase 2（Cat.1 模组）

- 实现 `mqtt.js` 的 MQTT over WebSocket 连接
- 注册 EMQX Cloud 免费版 MQTT Broker
- 模组通过 MQTT 接入，订阅 `todo/{userId}/sync`
- 设备上线时请求全量同步，离线时事件存入 D1

## 注意事项

- WebSocket 升级请求由 Worker 转发到 WsHub（Durable Object）处理：`env.WS_HUB.idFromName('default-hub')` 取固定实例后 `stub.fetch(request)`；直接对命名空间绑定调 `fetch` 会抛错（线上已踩坑）。
- 广播与在线状态同样走该固定实例（`/broadcast`、`/presence`、`/online`），保证连接与广播同实例。
- Worker isolate 内存不共享：任何连接 / 广播 / 在线状态都必须经 DO，不能放 Worker 进程内 Map。
- 钉钉回调签名验证（`verifyDingtalkCallback`）需按官方文档实现，当前为占位
