/**
 * MQTT 桥接模块（Phase 2 - Cat.1 模组接入）
 *
 * Cloudflare Worker 不支持原生 MQTT 客户端，
 * 方案：使用 MQTT over WebSocket 连接 EMQX Cloud。
 * EMQX Cloud 支持 WebSocket 接入：wss://xxx.emqx.cloud:8084/mqtt
 *
 * 替代方案：用 Cloudflare Workers 的 TCP connect() API 直连 MQTT Broker，
 * 但需要手动实现 MQTT 协议，复杂度高。
 *
 * 本文件先定义接口，Phase 2 实现。
 */

/** MQTT Topic 定义 */
export const MQTT_TOPICS = {
  /** 待办同步广播（服务端 -> 设备） */
  TODO_SYNC: (userId) => `todo/${userId}/sync`,
  /** 设备上报待办变更（设备 -> 服务端） */
  TODO_REPORT: (userId) => `todo/${userId}/report`,
  /** 设备在线状态 */
  DEVICE_STATUS: (deviceId) => `todo/${deviceId}/status`,
  /** 全量同步请求（设备上线时） */
  SYNC_REQUEST: (userId) => `todo/${userId}/request/full`,
};

/**
 * MQTT 客户端（占位，Phase 2 实现）
 *
 * 用法：
 *   const mqtt = new MqttBridge(env.MQTT_BROKER_URL, env.MQTT_USERNAME, env.MQTT_PASSWORD);
 *   await mqtt.connect();
 *   mqtt.subscribe(MQTT_TOPICS.TODO_REPORT(userId), (msg) => { ... });
 *   mqtt.publish(MQTT_TOPICS.TODO_SYNC(userId), event);
 */
export class MqttBridge {
  constructor(brokerUrl, username, password) {
    this.brokerUrl = brokerUrl;
    this.username = username;
    this.password = password;
    this.client = null;
    this.handlers = new Map();
  }

  async connect() {
    // TODO: Phase 2 实现 MQTT over WebSocket 连接
    // 使用 mqtt.js 浏览器版（支持 WebSocket），但 Worker 环境需要适配
    console.log('[MQTT] connect placeholder', this.brokerUrl);
  }

  subscribe(topic, handler) {
    // TODO: Phase 2
    this.handlers.set(topic, handler);
  }

  publish(topic, payload) {
    // TODO: Phase 2
    console.log('[MQTT] publish', topic, payload);
  }

  disconnect() {
    // TODO: Phase 2
  }
}
