import axios from 'axios';
import crypto from 'crypto';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_API = 'https://open.feishu.cn/open-apis';

let tokenCache = { token: null, expire: 0 };
let ticketCache = { ticket: null, expire: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expire > now + 60000) return tokenCache.token;
  const r = await axios.post(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID,
    , app_secret: APP_SECRET
  });
  tokenCache = { token: r.data.tenant_access_token, expire: now + r.data.expire * 1000 };
  return tokenCache.token;
}

async function getTicket() {
  const now = Date.now();
  if (ticketCache.ticket && ticketCache.expire > now + 60000) return ticketCache.ticket;
  const token = await getToken();
  const r = await axios.post(`${FEISHU_API}/jssdk/ticket/get`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  ticketCache = { ticket: r.data.data.ticket, expire: now + r.data.data.expire_in * 1000 };
  return ticketCache.ticket;
}

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: '缺少 url 参数' });
    const ticket = await getTicket();
    const nonceStr = Math.random().toString(36).slice(2, 18);
    const timestamp = Math.floor(Date.now() / 1000);
    const str = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${decodeURIComponent(url)}`;
    const signature = crypto.createHash('sha1').update(str).digest('hex');
    res.status(200).json({ success: true, data: { appId: APP_ID, timestamp, nonceStr, signature } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
