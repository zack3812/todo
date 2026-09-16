/**
 * 钉钉待办 API 封装
 * 文档：https://open.dingtalk.com/document/orgapp-server/add-dingtalk-to-do-task
 */

const DINGTALK_API = 'https://api.dingtalk.com';
const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';

/**
 * 获取企业内部应用 access_token
 * @param {string} appKey
 * @param {string} appSecret
 * @returns {Promise<string>} accessToken
 */
export async function getAccessToken(appKey, appSecret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = await res.json();
  if (!data.accessToken) {
    throw new Error(`钉钉 token 获取失败: ${JSON.stringify(data)}`);
  }
  return data.accessToken;
}

/**
 * 创建钉钉待办任务
 * @param {string} accessToken
 * @param {string} unionId - 创建者 unionId
 * @param {Object} task - 待办内容
 * @returns {Promise<string>} taskId
 */
export async function createTodoTask(accessToken, unionId, task) {
  const res = await fetch(
    `${DINGTALK_API}/v1.0/todo/users/${unionId}/tasks?operatorId=${unionId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        subject: task.text,
        description: task.project ? `项目: ${task.project}` : '',
        dueTime: task.dueTime ? new Date(task.dueTime).getTime() : undefined,
        executorIds: task.executorIds || [unionId],
        // detailUrl 必填（2024年2月起），指向本地应用或自定义协议
        detailUrl: `nexusdesk://todo/${task.id}`,
        sourceId: `nexusdesk-${task.id}`,
      }),
    }
  );
  const data = await res.json();
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`钉钉待办创建失败: ${JSON.stringify(data)}`);
  }
  return data.taskId || data.id;
}

/**
 * 更新钉钉待办任务（改日期、改内容、标记完成）
 * @param {string} accessToken
 * @param {string} unionId
 * @param {string} taskId
 * @param {Object} updates - 要更新的字段
 */
export async function updateTodoTask(accessToken, unionId, taskId, updates) {
  const body = {};
  if (updates.text !== undefined) body.subject = updates.text;
  if (updates.dueTime !== undefined) body.dueTime = updates.dueTime ? new Date(updates.dueTime).getTime() : null;
  if (updates.done !== undefined) body.taskStatus = updates.done ? 'COMPLETED' : 'TODO';

  const res = await fetch(
    `${DINGTALK_API}/v1.0/todo/users/${unionId}/tasks/${taskId}?operatorId=${unionId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify(body),
    }
  );
  if (res.status !== 200) {
    const data = await res.json();
    throw new Error(`钉钉待办更新失败: ${JSON.stringify(data)}`);
  }
}

/**
 * 删除钉钉待办任务
 */
export async function deleteTodoTask(accessToken, unionId, taskId) {
  const res = await fetch(
    `${DINGTALK_API}/v1.0/todo/users/${unionId}/tasks/${taskId}?operatorId=${unionId}`,
    {
      method: 'DELETE',
      headers: { 'x-acs-dingtalk-access-token': accessToken },
    }
  );
  if (res.status !== 200) {
    const data = await res.json();
    throw new Error(`钉钉待办删除失败: ${JSON.stringify(data)}`);
  }
}

/**
 * 验证钉钉回调签名（事件订阅回调）
 * @param {string} signature - 请求头中的签名
 * @param {string} timestamp - 请求头中的时间戳
 * @param {string} nonce - 请求头中的随机串
 * @param {string} body - 请求体原文
 * @param {string} token - 事件订阅的 EncodingAESKey / Token
 * @returns {boolean}
 */
export async function verifyDingtalkCallback(signature, timestamp, nonce, body, token) {
  if (![signature, timestamp, nonce, body, token].every((value) => typeof value === 'string' && value)) {
    return false;
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return expected === signature;
}
