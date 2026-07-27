/**
 * 溯流项目评估系统 - 飞书H5应用后端服务
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const {
  getJsapiConfig,
  getUserAccessToken,
  getUserInfo,
  listBitableRecords,
  getBitableRecord,
  createBitableRecord,
} = require('./feishu-api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 鉴权相关接口 ====================

app.get('/api/jsapi-config', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: '缺少 url 参数' });
    }

    const config = await getJsapiConfig(decodeURIComponent(url));
    res.json({
      success: true,
      data: config,
    });
  } catch (err) {
    console.error('JSAPI 鉴权错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: '缺少 code 参数' });
    }

    const tokenData = await getUserAccessToken(code);
    const userInfo = await getUserInfo(tokenData.access_token);

    res.json({
      success: true,
      data: {
        user: {
          name: userInfo.name,
          avatar: userInfo.avatar_url,
          userId: userInfo.user_id,
          openId: userInfo.open_id,
          email: userInfo.email,
          mobile: userInfo.mobile,
        },
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
      },
    });
  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ==================== 项目相关接口 ====================

const TABLE_PROJECT = process.env.BITABLE_TABLE_PROJECT || 'tbloKPiMWJZ3cJ85';
const TABLE_EVALUATION = process.env.BITABLE_TABLE_EVALUATION || 'tblVXTg0NvJooJmu';

app.get('/api/projects', async (req, res) => {
  try {
    const { page_size = 20, page_token, keyword, status } = req.query;

    const params = {
      page_size: parseInt(page_size),
    };
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
    if (status) {
      conditions.push({
        field_name: '项目状态',
        operator: 'is',
        value: status,
      });
    }

    if (conditions.length > 0) {
      params.filter = {
        conjunction: 'and',
        conditions,
      };
    }

    const data = await listBitableRecords(TABLE_PROJECT, params);

    const projects = data.items.map((item) => ({
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
      createDate: item.fields['录入日期'] || '',
    }));

    res.json({
      success: true,
      data: {
        items: projects,
        total: data.total,
        has_more: data.has_more,
        page_token: data.page_token,
      },
    });
  } catch (err) {
    console.error('获取项目列表错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get('/api/projects/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const data = await getBitableRecord(TABLE_PROJECT, recordId);

    const fields = data.record.fields;
    const project = {
      recordId: data.record.record_id,
      projectName: fields['项目名称'] || '',
      projectCode: fields['项目编号'] || '',
      projectType: fields['项目类型'] || '',
      contractAmount: fields['合同额万元'] || 0,
      responsibleUnit: fields['负责单位'] || '',
      region: fields['区域'] || '',
      projectStage: fields['项目阶段'] || '',
      projectStatus: fields['项目状态'] || '',
      planBiddingDate: fields['计划招标日期'] || '',
      createDate: fields['录入日期'] || '',
    };

    res.json({
      success: true,
      data: project,
    });
  } catch (err) {
    console.error('获取项目详情错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ==================== 评估记录相关接口 ====================

app.get('/api/evaluations', async (req, res) => {
  try {
    const { projectRecordId, page_size = 50 } = req.query;

    const params = {
      page_size: parseInt(page_size),
      sort: [{ field_name: '评估日期', desc: true }],
    };

    if (projectRecordId) {
      params.filter = {
        conjunction: 'and',
        conditions: [
          {
            field_name: '关联项目',
            operator: 'contains',
            value: projectRecordId,
          },
        ],
      };
    }

    const data = await listBitableRecords(TABLE_EVALUATION, params);

    const evaluations = data.items.map((item) => {
      const f = item.fields;
      const scores = calculateScores(f);
      return {
        recordId: item.record_id,
        evaluationCode: f['评估编号'] || '',
        evaluationDate: f['评估日期'] || '',
        projectStage: f['项目阶段'] || '',
        totalScore: scores.totalScore,
        level: scores.level,
        riskLevel: scores.riskLevel,
        warningFlags: getWarningFlags(f),
      };
    });

    res.json({
      success: true,
      data: {
        items: evaluations,
        total: data.total,
        has_more: data.has_more,
      },
    });
  } catch (err) {
    console.error('获取评估记录错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get('/api/evaluations/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const data = await getBitableRecord(TABLE_EVALUATION, recordId);

    const f = data.record.fields;
    const scores = calculateScores(f);

    const evaluation = {
      recordId: data.record.record_id,
      evaluationCode: f['评估编号'] || '',
      evaluationDate: f['评估日期'] || '',
      projectStage: f['项目阶段'] || '',
      filledBy: f['填写人'] || '',
      dimension1: scores.dimensions.dimension1,
      dimension2: scores.dimensions.dimension2,
      dimension3: scores.dimensions.dimension3,
      dimension4: scores.dimensions.dimension4,
      dimension5: scores.dimensions.dimension5,
      dimension6: scores.dimensions.dimension6,
      totalScore: scores.totalScore,
      level: scores.level,
      riskLevel: scores.riskLevel,
      warningFlags: getWarningFlags(f),
      rawFields: f,
    };

    res.json({
      success: true,
      data: evaluation,
    });
  } catch (err) {
    console.error('获取评估详情错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post('/api/evaluations', async (req, res) => {
  try {
    const { projectRecordId, fields } = req.body;

    if (!projectRecordId) {
      return res.status(400).json({ error: '缺少 projectRecordId' });
    }

    const recordFields = {
      ...fields,
      '关联项目': [projectRecordId],
    };

    const data = await createBitableRecord(TABLE_EVALUATION, recordFields);

    res.json({
      success: true,
      data: {
        recordId: data.record.record_id,
      },
    });
  } catch (err) {
    console.error('提交评估记录错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ==================== 评估问卷配置接口 ====================

app.get('/api/questionnaire/config', async (req, res) => {
  try {
    const questionnaire = {
      title: '项目全维度评估问卷',
      description: '请根据项目实际情况，对以下各维度进行评分',
      sections: [
        {
          key: 'dimension1',
          title: '一、客户关系维度',
          weight: 0.2,
          questions: [
            { key: '1_1_决策人对接层级', label: '1.1 决策人对接层级', type: 'rating', max: 5 },
            { key: '1_2_信任关系深度', label: '1.2 信任关系深度', type: 'rating', max: 5 },
            { key: '1_3_关键信息掌握度', label: '1.3 关键信息掌握度', type: 'rating', max: 5 },
          ],
        },
        {
          key: 'dimension2',
          title: '二、资金与商务维度',
          weight: 0.15,
          questions: [
            { key: '2_1_资金来源落实情况', label: '2.1 资金来源落实情况', type: 'rating', max: 5 },
          ],
        },
        {
          key: 'dimension3',
          title: '三、项目跟进维度',
          weight: 0.15,
          questions: [
            { key: '3_1_项目需求介入深度', label: '3.1 项目需求介入深度', type: 'rating', max: 5 },
            { key: '3_2_项目进度跟进情况', label: '3.2 项目进度跟进情况', type: 'rating', max: 5 },
          ],
        },
        {
          key: 'dimension4',
          title: '四、竞争格局维度',
          weight: 0.2,
          questions: [
            { key: '4_1_竞争对手情况', label: '4.1 竞争对手情况', type: 'rating', max: 5 },
            { key: '4_2_项目准入壁垒', label: '4.2 项目准入壁垒', type: 'rating', max: 5 },
            { key: '4_3_联合体合作方支撑', label: '4.3 联合体合作方支撑', type: 'rating', max: 5 },
          ],
        },
        {
          key: 'dimension5',
          title: '五、招标技术维度',
          weight: 0.2,
          questions: [
            { key: '5_1_代理方对接与信息获取', label: '5.1 代理方对接与信息获取', type: 'rating', max: 5 },
            { key: '5_2_技术参数设置', label: '5.2 技术参数设置', type: 'rating', max: 5 },
            { key: '5_3_评分标准设置', label: '5.3 评分标准设置', type: 'rating', max: 5 },
            { key: '5_4_招标文件整体影响力', label: '5.4 招标文件整体影响力', type: 'rating', max: 5 },
          ],
        },
        {
          key: 'dimension6',
          title: '六、风险预警维度',
          weight: 0.1,
          questions: [
            { key: '6_1_其他风险', label: '6.1 其他风险', type: 'rating', max: 5 },
          ],
        },
      ],
      warningFields: [
        { key: '决策人变更预警', label: '决策人变更预警', type: 'checkbox' },
        { key: '明确需要垫资预警', label: '明确需要垫资预警', type: 'checkbox' },
      ],
    };

    res.json({
      success: true,
      data: questionnaire,
    });
  } catch (err) {
    console.error('获取问卷配置错误:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ==================== 评估计算逻辑 ====================

function calculateScores(fields) {
  const dimensions = {
    dimension1: {
      name: '客户关系维度',
      weight: 0.2,
      fields: ['1_1_决策人对接层级', '1_2_信任关系深度', '1_3_关键信息掌握度'],
    },
    dimension2: {
      name: '资金与商务维度',
      weight: 0.15,
      fields: ['2_1_资金来源落实情况'],
    },
    dimension3: {
      name: '项目跟进维度',
      weight: 0.15,
      fields: ['3_1_项目需求介入深度', '3_2_项目进度跟进情况'],
    },
    dimension4: {
      name: '竞争格局维度',
      weight: 0.2,
      fields: ['4_1_竞争对手情况', '4_2_项目准入壁垒', '4_3_联合体合作方支撑'],
    },
    dimension5: {
      name: '招标技术维度',
      weight: 0.2,
      fields: ['5_1_代理方对接与信息获取', '5_2_技术参数设置', '5_3_评分标准设置', '5_4_招标文件整体影响力'],
    },
    dimension6: {
      name: '风险预警维度',
      weight: 0.1,
      fields: ['6_1_其他风险'],
    },
  };

  let totalScore = 0;
  const dimScores = {};

  for (const [key, dim] of Object.entries(dimensions)) {
    const validFields = dim.fields.filter((f) => typeof fields[f] === 'number' && fields[f] > 0);
    if (validFields.length === 0) {
      dimScores[key] = { score: 0, name: dim.name, weight: dim.weight };
      continue;
    }

    const avg = validFields.reduce((sum, f) => sum + fields[f], 0) / validFields.length;
    const weightedScore = avg * dim.weight * 20;
    dimScores[key] = {
      score: Math.round(avg * 20),
      weightedScore: Math.round(weightedScore * 10) / 10,
      name: dim.name,
      weight: dim.weight,
    };
    totalScore += weightedScore;
  }

  totalScore = Math.round(totalScore * 10) / 10;

  let level = '待评估';
  let riskLevel = 'unknown';
  if (totalScore >= 80) {
    level = 'A 级（优秀）';
    riskLevel = 'low';
  } else if (totalScore >= 65) {
    level = 'B 级（良好）';
    riskLevel = 'medium';
  } else if (totalScore >= 50) {
    level = 'C 级（一般）';
    riskLevel = 'high';
  } else if (totalScore > 0) {
    level = 'D 级（较差）';
    riskLevel = 'critical';
  }

  return {
    dimensions: dimScores,
    totalScore,
    level,
    riskLevel,
  };
}

function getWarningFlags(fields) {
  const flags = [];
  if (fields['决策人变更预警']) {
    flags.push({ key: 'decision_change', label: '决策人变更预警', type: 'warning' });
  }
  if (fields['明确需要垫资预警']) {
    flags.push({ key: 'advance_payment', label: '明确需要垫资预警', type: 'danger' });
  }
  return flags;
}

// ==================== 健康检查 ====================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      appId: process.env.FEISHU_APP_ID ? '已配置' : '未配置',
      bitableToken: process.env.BITABLE_APP_TOKEN ? '已配置' : '未配置',
    },
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`
  ============================================
  🚀 溯流项目评估系统 - 飞书H5应用后端服务
  ============================================
  服务地址: http://localhost:${PORT}
  前端页面: http://localhost:${PORT}/
  健康检查: http://localhost:${PORT}/api/health
  ============================================
  `);
});