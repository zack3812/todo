/**
 * NexusDesk Cloud - 事件格式定义
 * 桌面端、Cloudflare Worker、Cat.1 模组三方共享
 */

export const EVENT_TYPES = {
  TODO_CREATE: 'todo.create',
  TODO_UPDATE: 'todo.update',
  TODO_DELETE: 'todo.delete',
  TODO_COMPLETE: 'todo.complete',
  DEVICE_STATUS: 'device.status',
  SYNC_REQUEST: 'sync.request',
  SYNC_RESPONSE: 'sync.response',
};

export const SOURCES = {
  DESKTOP: 'desktop',
  CAT1: 'cat1',
  DINGTALK: 'dingtalk',
  CLOUD: 'cloud',
};

/**
 * 创建待办同步事件
 * @param {Object} todo - 待办对象
 * @param {string} source - 来源 desktop | cat1 | dingtalk
 * @returns {Object} 标准事件
 */
export function createTodoEvent(todo, source) {
  return {
    event: todo.done ? EVENT_TYPES.TODO_COMPLETE : EVENT_TYPES.TODO_CREATE,
    todoId: todo.id,
    dingtalkTaskId: todo.dingtalkTaskId || null,
    source,
    timestamp: Date.now(),
    payload: {
      text: todo.text,
      category: todo.category,
      project: todo.project || '',
      dueTime: todo.dueTime || null,
      done: todo.done || false,
      executorIds: todo.executorIds || [],
    },
  };
}

/**
 * 创建更新事件
 */
export function updateTodoEvent(todo, source, changedFields) {
  return {
    event: EVENT_TYPES.TODO_UPDATE,
    todoId: todo.id,
    dingtalkTaskId: todo.dingtalkTaskId || null,
    source,
    timestamp: Date.now(),
    changedFields,
    payload: {
      text: todo.text,
      category: todo.category,
      project: todo.project || '',
      dueTime: todo.dueTime || null,
      done: todo.done || false,
    },
  };
}

/**
 * 创建设备状态事件
 */
export function deviceStatusEvent(deviceId, online) {
  return {
    event: EVENT_TYPES.DEVICE_STATUS,
    deviceId,
    online,
    timestamp: Date.now(),
  };
}
