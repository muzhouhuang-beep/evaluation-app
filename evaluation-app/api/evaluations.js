import axios from 'axios';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_TOKEN = process.env.BITABLE_APP_TOKEN;
const TABLE_ID = process.env.BITABLE_TABLE_EVALUATION || 'tblVXTg0NvJooJmu';
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

function calcScores(fields) {
  const dims = {
    dimension1: { name: '客户关系维度', weight: 0.2, fields: ['1_1_决策人对接层级', '1_2_信任关系深度', '1_3_关键信息掌握度'] },
    dimension2: { name: '资金与商务维度', weight: 0.15, fields: ['2_1_资金来源落实情况'] },
    dimension3: { name: '项目跟进维度', weight: 0.15, fields: ['3_1_项目需求介入深度', '3_2_项目进度跟进情况'] },
    dimension4: { name: '竞争格局维度', weight: 0.2, fields: ['4_1_竞争对手情况', '4_2_项目准入壁垒', '4_3_联合体合作方支撑'] },
    dimension5: { name: '招标技术维度', weight: 0.2, fields: ['5_1_代理方对接与信息获取', '5_2_技术参数设置', '5_3_评分标准设置', '5_4_招标文件整体影响力'] },
    dimension6: { name: '风险预警维度', weight: 0.1, fields: ['6_1_其他风险'] },
  };
  let total = 0;
  const result = {};
  for (const [key, dim] of Object.entries(dims)) {
    const valid = dim.fields.filter(f => typeof fields[f] === 'number' && fields[f] > 0);
    if (valid.length === 0) { result[key] = { score: 0, name: dim.name, weightedScore: 0 }; continue; }
    const avg = valid.reduce((s, f) => s + fields[f], 0) / valid.length;
    const score = avg * 20;
    const weighted = score * dim.weight;
    result[key] = { score: Math.round(score), weightedScore: Math.round(weighted * 10) / 10, name: dim.name };
    total += weighted;
  }
  total = Math.round(total * 10) / 10;
  let level = '待评估', risk = 'unknown';
  if (total >= 80) { level = 'A 级（优秀）'; risk = 'low'; }
  else if (total >= 65) { level = 'B 级（良好）'; risk = 'medium'; }
  else if (total >= 50) { level = 'C 级（一般）'; risk = 'high'; }
  else if (total > 0) { level = 'D 级（较差）'; risk = 'critical'; }
  return { dimensions: result, totalScore: total, level, riskLevel: risk };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { projectRecordId, page_size = 50 } = req.query;
      const token = await getToken();
      const params = { page_size: parseInt(page_size), sort: JSON.stringify([{ field_name: '评估日期', desc: true }]) };
      if (projectRecordId) {
        params.filter = JSON.stringify({
          conjunction: 'and',
          conditions: [{ field_name: '关联项目', operator: 'contains', value: projectRecordId }],
        });
      }
      const r = await axios.get(
        `${FEISHU_API}/bitable/v1/apps/${BITABLE_TOKEN}/tables/${TABLE_ID}/records`,
        { headers: { Authorization: `Bearer ${token}` }, params }
      );
      const items = r.data.data.items.map(item => {
        const scores = calcScores(item.fields);
        const warnings = [];
        if (item.fields['决策人变更预警']) warnings.push({ key: 'decision_change', label: '决策人变更预警', type: 'warning' });
        if (item.fields['明确需要垫资预警']) warnings.push({ key: 'advance_payment', label: '明确需要垫资预警', type: 'danger' });
        return {
          recordId: item.record_id,
          evaluationCode: item.fields['评估编号'] || '',
          evaluationDate: item.fields['评估日期'] || '',
          projectStage: item.fields['项目阶段'] || '',
          totalScore: scores.totalScore,
          level: scores.level,
          riskLevel: scores.riskLevel,
          warningFlags: warnings,
        };
      });
      res.status(200).json({ success: true, data: { items, total: r.data.data.total, has_more: r.data.data.has_more } });
    } else if (req.method === 'POST') {
      const { projectRecordId, fields } = req.body;
      if (!projectRecordId) return res.status(400).json({ error: '缺少 projectRecordId' });
      const token = await getToken();
      const recordFields = { ...fields, '关联项目': [projectRecordId] };
      const r = await axios.post(
        `${FEISHU_API}/bitable/v1/apps/${BITABLE_TOKEN}/tables/${TABLE_ID}/records`,
        { fields: recordFields },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      res.status(200).json({ success: true, data: { recordId: r.data.data.record.record_id } });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
