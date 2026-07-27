import axios from 'axios';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_TOKEN = process.env.BITABLE_APP_TOKEN;
const TABLE_ID = process.env.BITABLE_TABLE_PROJECT || 'tbloKPiMWJZ3cJ85';
const FEISHU_API = 'https://open.feishu.cn/open-apis';

let tokenCache = { token: null, expire: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expire > now + 60000) return tokenCache.token;
  const r = await axios.post(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID, app_secret: APP_SECRET
  });
  tokenCache = { token: r.data.tenant_access_token, expire: now + r.data.expire * 1000 };
  return tokenCache.token;
}

export default async function handler(req, res) {
  try {
    const { page_size = 20, page_token, keyword, status } = req.query;
    const token = await getToken();
    const params = { page_size: parseInt(page_size) };
    if (page_token) params.page_token = page_token;
    const conditions = [];
    if (keyword) {
      conditions.push({
        conjunction: 'or',
        conditions: [
          { field_name: '项目名称', operator: 'contains', value: keyword },
          { field_name: '项目编号', operator: 'contains', value: keyword },
        ],
      });
    }
    if (status) conditions.push({ field_name: '项目状态', operator: 'is', value: status });
    if (conditions.length > 0) params.filter = JSON.stringify({ conjunction: 'and', conditions });

    const r = await axios.get(
      `${FEISHU_API}/bitable/v1/apps/${BITABLE_TOKEN}/tables/${TABLE_ID}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params }
    );
    const data = r.data.data;
    const items = data.items.map(item => ({
      recordId: item.record_id,
      projectName: item.fields['项目名称'] || '',
      projectCode: item.fields['项目编号'] || '',
      projectType: item.fields['项目类型'] || '',
      contractAmount: item.fields['合同额万元'] || 0,
      responsibleUnit: item.fields['负责单位'] || '',
      region: item.fields['区域'] || '',
      projectStage: item.fields['项目阶段'] || '',
      projectStatus: item.fields['项目状态'] || '',
      planBiddingDate: item.fields['计划招标日期'] || '',
    }));
    res.status(200).json({
      success: true,
      data: { items, total: data.total, has_more: data.has_more, page_token: data.page_token }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
