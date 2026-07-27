/**
 * 飞书开放平台 API 工具类
 * 负责：获取 token、JSAPI 鉴权、多维表格数据读写
 */

const axios = require('axios');
require('dotenv').config();

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// 缓存 tenant_access_token
let tenantTokenCache = {
  token: null,
  expireTime: 0,
};

// 缓存 jsapi_ticket
let jsapiTicketCache = {
  ticket: null,
  expireTime: 0,
};

/**
 * 获取 tenant_access_token（应用身份凭证）
 */
async function getTenantAccessToken() {
  const now = Date.now();
  if (tenantTokenCache.token && tenantTokenCache.expireTime > now + 60000) {
    return tenantTokenCache.token;
  }

  try {
    const res = await axios.post(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        app_id: APP_ID,
        app_secret: APP_SECRET,
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`获取 tenant_access_token 失败: ${res.data.msg}`);
    }

    tenantTokenCache = {
      token: res.data.tenant_access_token,
      expireTime: now + res.data.expire * 1000,
    };

    return tenantTokenCache.token;
  } catch (err) {
    console.error('获取 tenant_access_token 错误:', err.message);
    throw err;
  }
}

/**
 * 获取 app_access_token（用于换取 user_access_token）
 */
async function getAppAccessToken() {
  try {
    const res = await axios.post(
      `${FEISHU_API_BASE}/auth/v3/app_access_token/internal`,
      {
        app_id: APP_ID,
        app_secret: APP_SECRET,
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`获取 app_access_token 失败: ${res.data.msg}`);
    }

    return res.data.app_access_token;
  } catch (err) {
    console.error('获取 app_access_token 错误:', err.message);
    throw err;
  }
}

/**
 * 用授权码 code 换取 user_access_token
 */
async function getUserAccessToken(code) {
  try {
    const appToken = await getAppAccessToken();
    const res = await axios.post(
      `${FEISHU_API_BASE}/authen/v1/access_token`,
      {
        grant_type: 'authorization_code',
        code: code,
      },
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`换取 user_access_token 失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('换取 user_access_token 错误:', err.message);
    throw err;
  }
}

/**
 * 获取用户信息
 */
async function getUserInfo(userAccessToken) {
  try {
    const res = await axios.get(`${FEISHU_API_BASE}/authen/v1/user_info`, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });

    if (res.data.code !== 0) {
      throw new Error(`获取用户信息失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('获取用户信息错误:', err.message);
    throw err;
  }
}

/**
 * 获取 jsapi_ticket
 */
async function getJsapiTicket() {
  const now = Date.now();
  if (jsapiTicketCache.ticket && jsapiTicketCache.expireTime > now + 60000) {
    return jsapiTicketCache.ticket;
  }

  try {
    const token = await getTenantAccessToken();
    const res = await axios.post(
      `${FEISHU_API_BASE}/jssdk/ticket/get`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`获取 jsapi_ticket 失败: ${res.data.msg}`);
    }

    jsapiTicketCache = {
      ticket: res.data.data.ticket,
      expireTime: now + res.data.data.expire_in * 1000,
    };

    return jsapiTicketCache.ticket;
  } catch (err) {
    console.error('获取 jsapi_ticket 错误:', err.message);
    throw err;
  }
}

/**
 * 生成 JSAPI 鉴权签名
 */
function generateSignature(ticket, nonceStr, timestamp, url) {
  const crypto = require('crypto');
  const string1 = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return crypto.createHash('sha1').update(string1).digest('hex');
}

/**
 * 获取 JSAPI 鉴权配置
 */
async function getJsapiConfig(url) {
  const ticket = await getJsapiTicket();
  const nonceStr = Math.random().toString(36).substring(2, 18);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(ticket, nonceStr, timestamp, url);

  return {
    appId: APP_ID,
    timestamp,
    nonceStr,
    signature,
  };
}

// ==================== 多维表格操作 ====================

/**
 * 读取多维表格记录列表
 */
async function listBitableRecords(tableId, params = {}) {
  try {
    const token = await getTenantAccessToken();
    const res = await axios.get(
      `${FEISHU_API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          page_size: params.page_size || 100,
          ...(params.page_token ? { page_token: params.page_token } : {}),
          ...(params.filter ? { filter: JSON.stringify(params.filter) } : {}),
          ...(params.sort ? { sort: JSON.stringify(params.sort) } : {}),
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`读取多维表格失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('读取多维表格错误:', err.message);
    throw err;
  }
}

/**
 * 读取单条记录
 */
async function getBitableRecord(tableId, recordId) {
  try {
    const token = await getTenantAccessToken();
    const res = await axios.get(
      `${FEISHU_API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`读取记录失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('读取记录错误:', err.message);
    throw err;
  }
}

/**
 * 新增记录
 */
async function createBitableRecord(tableId, fields) {
  try {
    const token = await getTenantAccessToken();
    const res = await axios.post(
      `${FEISHU_API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`创建记录失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('创建记录错误:', err.message);
    throw err;
  }
}

/**
 * 更新记录
 */
async function updateBitableRecord(tableId, recordId, fields) {
  try {
    const token = await getTenantAccessToken();
    const res = await axios.put(
      `${FEISHU_API_BASE}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(`更新记录失败: ${res.data.msg}`);
    }

    return res.data.data;
  } catch (err) {
    console.error('更新记录错误:', err.message);
    throw err;
  }
}

module.exports = {
  getTenantAccessToken,
  getAppAccessToken,
  getUserAccessToken,
  getUserInfo,
  getJsapiConfig,
  listBitableRecords,
  getBitableRecord,
  createBitableRecord,
  updateBitableRecord,
  BITABLE_APP_TOKEN,
};