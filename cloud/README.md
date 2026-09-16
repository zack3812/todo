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
│   ├── index.js       # Worker 入口：HTTP 路由 + WebSocket 网关
│   ├── dingtalk.js    # 钉钉待办 API 封装
│   ├── events.js      # 事件格式定义（桌面端共享）
│   └── mqtt.js        # MQTT 桥接（Phase 2）
├── wrangler.toml      # Cloudflare Worker 配置
└── package.json
```

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

### 3. 创建 KV 命名空间（离线事件队列）

```bash
npx wrangler kv namespace create EVENT_QUEUE
# 把返回的 id 填入 wrangler.toml
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
| `/ws?userId=xxx` | GET (WebSocket) | 桌面端 WebSocket 连接 |
| `/api/todo/sync` | POST | 桌面端 REST 同步（兜底） |

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
const ws = new WebSocket('wss://api.nexusdesk.dpdns.org/ws?userId=xxx');
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
- 设备上线时请求全量同步，离线时事件存入 KV 队列

## 注意事项

- Worker 标准运行时的 WebSocket 服务端需要 WebSocketPair，单实例内连接有效
- 生产环境多实例部署建议迁移到 Durable Objects 实现跨实例连接管理
- 钉钉回调签名验证（`verifyDingtalkCallback`）需按官方文档实现，当前为占位
