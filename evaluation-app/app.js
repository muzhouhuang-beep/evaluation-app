/**
 * 溯流项目评估系统 - 飞书H5应用 前端主逻辑
 */

const API_BASE = '/api';

const state = {
  user: null,
  currentPage: 'projects',
  currentProject: null,
  currentEvaluation: null,
  questionnaireConfig: null,
  projects: [],
  projectsPageToken: null,
  projectsHasMore: false,
  searchKeyword: '',
  filterStatus: '',
  questionnaireAnswers: {},
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 溯流项目评估系统 H5 启动');

  await initFeishuJSSDK();
  await tryFeishuLogin();
  await loadQuestionnaireConfig();
  await loadProjects();
  bindEvents();
});

async function initFeishuJSSDK() {
  try {
    const currentUrl = window.location.href.split('#')[0];
    const res = await fetch(`${API_BASE}/jsapi-config?url=${encodeURIComponent(currentUrl)}`);
    const data = await res.json();

    if (data.success && window.h5sdk) {
      window.h5sdk.config({
        appId: data.data.appId,
        timestamp: data.data.timestamp,
        nonceStr: data.data.nonceStr,
        signature: data.data.signature,
        jsApiList: ['biz.user.getUserInfo', 'biz.util.openDocument'],
        onSuccess: () => { console.log('✅ JSAPI 鉴权成功'); },
        onFail: (err) => { console.warn('⚠️ JSAPI 鉴权失败:', err); },
      });
    }
  } catch (err) {
    console.warn('JSAPI 鉴权跳过（开发环境可忽略）', err);
  }
}

async function tryFeishuLogin() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (data.success) {
        state.user = data.data.user;
        localStorage.setItem('user', JSON.stringify(state.user));
        renderUserAvatar();
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
    }

    const cachedUser = localStorage.getItem('user');
    if (cachedUser) {
      state.user = JSON.parse(cachedUser);
      renderUserAvatar();
      return;
    }

    if (window.h5sdk) {
      window.h5sdk.ready(() => {
        tt.requestAccess({
          appID: '',
          scopeList: [],
          success: async (res) => {
            console.log('获取授权码成功:', res.code);
          },
          fail: (err) => {
            console.log('免登跳过:', err);
          },
        });
      });
    }
  } catch (err) {
    console.warn('免登跳过:', err);
  }
}

function renderUserAvatar() {
  const avatarEl = document.getElementById('userAvatar');
  if (state.user && state.user.name) {
    avatarEl.textContent = state.user.name.charAt(0);
  }
}

// ==================== 页面导航 ====================
function navigateTo(pageName, data = {}) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));

  const targetPage = document.getElementById(`page-${pageName}`);
  if (targetPage) targetPage.classList.add('active');

  updateHeader(pageName);
  state.currentPage = pageName;

  switch (pageName) {
    case 'project-detail':
      state.currentProject = data.project;
      renderProjectDetail(data.project);
      loadEvaluations(data.project.recordId);
      break;
    case 'questionnaire':
      renderQuestionnaire();
      break;
    case 'report':
      renderReport(data.evaluation);
      break;
  }
}

function updateHeader(pageName) {
  const titleEl = document.getElementById('headerTitle');
  const backEl = document.getElementById('headerBack');

  const titles = {
    projects: '项目评估',
    'project-detail': '项目详情',
    questionnaire: '评估问卷',
    report: '评估报告',
  };

  titleEl.textContent = titles[pageName] || '项目评估';

  if (pageName !== 'projects') {
    backEl.style.display = 'flex';
    backEl.onclick = goBack;
  } else {
    backEl.style.display = 'none';
  }
}

function goBack() {
  const historyMap = {
    'project-detail': 'projects',
    questionnaire: 'project-detail',
    report: 'project-detail',
  };
  const prevPage = historyMap[state.currentPage] || 'projects';
  navigateTo(prevPage);
}

// ==================== 项目列表 ====================
async function loadProjects() {
  const listEl = document.getElementById('projectList');
  listEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    let url = `${API_BASE}/projects?page_size=20`;
    if (state.searchKeyword) url += `&keyword=${encodeURIComponent(state.searchKeyword)}`;
    if (state.filterStatus) url += `&status=${encodeURIComponent(state.filterStatus)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.success) {
      state.projects = data.data.items;
      state.projectsPageToken = data.data.page_token;
      state.projectsHasMore = data.data.has_more;
      renderProjectList();
    } else {
      listEl.innerHTML = '<div class="empty-tip">加载失败</div>';
    }
  } catch (err) {
    listEl.innerHTML = '<div class="empty-tip">网络错误</div>';
    console.error(err);
  }
}

function renderProjectList() {
  const listEl = document.getElementById('projectList');

  if (state.projects.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">暂无项目数据</div>';
    return;
  }

  listEl.innerHTML = state.projects
    .map((p) => `
    <div class="project-card" onclick="navigateTo('project-detail', { project: ${JSON.stringify(p).replace(/"/g, '&quot;')} })">
      <div class="project-card-header">
        <div class="project-name">${escapeHtml(p.projectName) || '未命名项目'}</div>
        <span class="project-status-tag status-${p.projectStatus || ''}">${p.projectStatus || '未知'}</span>
      </div>
      <div class="project-meta">
        <span class="project-meta-item">📋 ${p.projectCode || '-'}</span>
        <span class="project-meta-item">📍 ${p.region || '-'}</span>
        <span class="project-meta-item">🏢 ${p.responsibleUnit || '-'}</span>
      </div>
      <div class="project-amount">¥ ${p.contractAmount || 0} 万</div>
    </div>
  `).join('');

  const loadMoreEl = document.getElementById('loadMore');
  loadMoreEl.style.display = state.projectsHasMore ? 'block' : 'none';
}

async function searchProjects() {
  state.searchKeyword = document.getElementById('searchInput').value.trim();
  await loadProjects();
  showToast('搜索完成');
}

async function filterByStatus(el, status) {
  document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
  el.classList.add('active');
  state.filterStatus = status;
  await loadProjects();
}

async function loadMoreProjects() {
  if (!state.projectsPageToken) return;

  try {
    const res = await fetch(`${API_BASE}/projects?page_size=20&page_token=${state.projectsPageToken}`);
    const data = await res.json();

    if (data.success) {
      state.projects = [...state.projects, ...data.data.items];
      state.projectsPageToken = data.data.page_token;
      state.projectsHasMore = data.data.has_more;
      renderProjectList();
    }
  } catch (err) {
    console.error(err);
  }
}

// ==================== 项目详情 ====================
function renderProjectDetail(project) {
  const container = document.getElementById('projectDetail');

  container.innerHTML = `
    <h2 class="detail-title">${escapeHtml(project.projectName)}</h2>
    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-label">项目编号</span>
        <span class="detail-value">${project.projectCode || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">项目类型</span>
        <span class="detail-value">${project.projectType || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">合同额</span>
        <span class="detail-value">¥ ${project.contractAmount || 0} 万</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">负责单位</span>
        <span class="detail-value">${project.responsibleUnit || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">区域</span>
        <span class="detail-value">${project.region || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">项目阶段</span>
        <span class="detail-value">${project.projectStage || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">计划招标日期</span>
        <span class="detail-value">${project.planBiddingDate || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">项目状态</span>
        <span class="detail-value">${project.projectStatus || '-'}</span>
      </div>
    </div>
  `;
}

async function loadEvaluations(projectRecordId) {
  const listEl = document.getElementById('evaluationList');
  listEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch(`${API_BASE}/evaluations?projectRecordId=${projectRecordId}`);
    const data = await res.json();

    if (data.success && data.data.items.length > 0) {
      listEl.innerHTML = data.data.items
        .map((e) => `
        <div class="evaluation-card" onclick="viewEvaluation('${e.recordId}')">
          <div class="evaluation-info">
            <div class="evaluation-date">${e.evaluationDate || '-'}</div>
            <div class="evaluation-stage">${e.projectStage || '-'}</div>
          </div>
          <div class="evaluation-score">
            <div class="score-value level-${e.level.charAt(0)}">${e.totalScore || 0}</div>
            <div class="score-level level-${e.level.charAt(0)}">${e.level}</div>
          </div>
        </div>
      `).join('');
    } else {
      listEl.innerHTML = '<div class="empty-tip">暂无评估记录，点击上方"新建评估"开始</div>';
    }
  } catch (err) {
    listEl.innerHTML = '<div class="empty-tip">加载失败</div>';
  }
}

async function viewEvaluation(recordId) {
  try {
    const res = await fetch(`${API_BASE}/evaluations/${recordId}`);
    const data = await res.json();

    if (data.success) {
      navigateTo('report', { evaluation: data.data });
    }
  } catch (err) {
    showToast('加载评估失败');
  }
}

function goToQuestionnaire() {
  state.questionnaireAnswers = {};
  navigateTo('questionnaire');
}

// ==================== 问卷 ====================
async function loadQuestionnaireConfig() {
  try {
    const res = await fetch(`${API_BASE}/questionnaire/config`);
    const data = await res.json();

    if (data.success) {
      state.questionnaireConfig = data.data;
      document.getElementById('questionnaireTitle').textContent = data.data.title;
      document.getElementById('questionnaireDesc').textContent = data.data.description;
    }
  } catch (err) {
    console.error('加载问卷配置失败:', err);
  }
}

function renderQuestionnaire() {
  const container = document.getElementById('questionnaireContent');
  const config = state.questionnaireConfig;

  if (!config) {
    container.innerHTML = '<div class="loading">问卷加载失败</div>';
    return;
  }

  container.innerHTML = config.sections
    .map((section) => `
    <div class="question-section">
      <div class="section-header">
        <span class="section-title-text">${section.title}</span>
        <span class="section-weight">权重 ${(section.weight * 100).toFixed(0)}%</span>
      </div>
      ${section.questions
        .map((q) => `
        <div class="question-item">
          <label class="question-label">${q.label}</label>
          <div class="rating-stars" data-key="${q.key}">
            ${Array.from({ length: q.max }, (_, i) => i + 1)
              .map((v) => `
              <span class="rating-star" data-value="${v}" onclick="selectRating('${q.key}', ${v}, this)">${v}</span>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function selectRating(key, value, el) {
  state.questionnaireAnswers[key] = value;

  const parent = el.parentElement;
  parent.querySelectorAll('.rating-star').forEach((star, idx) => {
    if (idx < value) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });
}

// ==================== 得分预览与提交 ====================
function showScorePreview() {
  const scores = calculatePreviewScores();
  const modalBody = document.getElementById('scoreModalBody');

  modalBody.innerHTML = `
    <div style="text-align:center; margin-bottom:16px;">
      <div style="font-size:42px; font-weight:700; color:var(--primary-color);">${scores.totalScore}</div>
      <div style="font-size:16px; color:var(--text-secondary);">${scores.level}</div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${Object.entries(scores.dimensions)
        .map(([key, dim]) => `
        <div style="display:flex; justify-content:space-between; font-size:14px;">
          <span>${dim.name}</span>
          <span style="font-weight:600;">${dim.score}分</span>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('scoreModal').style.display = 'flex';
}

function closeScoreModal() {
  document.getElementById('scoreModal').style.display = 'none';
}

function calculatePreviewScores() {
  const config = state.questionnaireConfig;
  const dimensions = {};
  let totalScore = 0;

  config.sections.forEach((section) => {
    const validScores = section.questions
      .map((q) => state.questionnaireAnswers[q.key])
      .filter((v) => typeof v === 'number' && v > 0);

    const avg = validScores.length > 0 ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
    const score5To100 = avg * 20;
    const weightedScore = score5To100 * section.weight;

    dimensions[section.key] = {
      name: section.title.replace(/^[一二三四五六七八九十]+、/, ''),
      score: Math.round(score5To100),
      weightedScore,
    };

    totalScore += weightedScore;
  });

  totalScore = Math.round(totalScore * 10) / 10;

  let level = '待评估';
  if (totalScore >= 80) level = 'A 级（优秀）';
  else if (totalScore >= 65) level = 'B 级（良好）';
  else if (totalScore >= 50) level = 'C 级（一般）';
  else if (totalScore > 0) level = 'D 级（较差）';

  return { dimensions, totalScore, level };
}

async function submitEvaluation() {
  closeScoreModal();
  showToast('提交中...');

  try {
    const fields = {
      ...state.questionnaireAnswers,
      '评估日期': new Date().toISOString().split('T')[0],
      '项目阶段': state.currentProject?.projectStage || '',
    };

    document.querySelectorAll('.warning-section input[type="checkbox"]').forEach((cb) => {
      fields[cb.name] = cb.checked;
    });

    const res = await fetch(`${API_BASE}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectRecordId: state.currentProject.recordId,
        fields,
      }),
    });

    const data = await res.json();

    if (data.success) {
      showToast('提交成功');
      setTimeout(async () => {
        const detailRes = await fetch(`${API_BASE}/evaluations/${data.data.recordId}`);
        const detailData = await detailRes.json();
        if (detailData.success) {
          navigateTo('report', { evaluation: detailData.data });
        }
      }, 500);
    } else {
      showToast('提交失败: ' + data.error);
    }
  } catch (err) {
    showToast('网络错误');
  }
}

// ==================== 评估报告 ====================
function renderReport(evaluation) {
  const container = document.getElementById('reportContainer');
  const levelClass = evaluation.level.charAt(0);

  container.innerHTML = `
    <div class="report-header">
      <h2 class="report-title">项目评估报告</h2>
      <p class="report-subtitle">${state.currentProject?.projectName || ''} · ${evaluation.evaluationDate || ''}</p>
    </div>

    <div class="score-circle level-${levelClass}">
      <span class="score-circle-value">${evaluation.totalScore}</span>
      <span class="score-circle-label">${evaluation.level}</span>
    </div>

    <div class="dimension-scores">
      <h4 style="margin-bottom:12px;">各维度得分</h4>
      ${Object.entries(evaluation.dimensions)
        .filter(([k, v]) => v.score > 0)
        .map(([k, dim]) => `
        <div class="dimension-item">
          <span class="dimension-name">${dim.name}</span>
          <div class="dimension-bar">
            <div class="dimension-bar-fill" style="width: ${dim.score}%;"></div>
          </div>
          <span class="dimension-score-text">${dim.score}</span>
        </div>
      `).join('')}
    </div>

    ${evaluation.warningFlags && evaluation.warningFlags.length > 0 ? `
      <div class="warnings-section">
        <h4>⚠️ 风险预警</h4>
        ${evaluation.warningFlags.map((w) => `<span class="warning-badge">${w.label}</span>`).join('')}
      </div>
    ` : ''}

    <div style="margin-top: 24px; display:flex; gap:10px;">
      <button class="btn-secondary" onclick="goBack()">返回项目</button>
      <button class="btn-primary" onclick="shareReport()">分享报告</button>
    </div>
  `;
}

function shareReport() {
  showToast('分享功能开发中');
}

// ==================== 工具函数 ====================
function bindEvents() {
  document.getElementById('questionnaireForm').addEventListener('submit', (e) => {
    e.preventDefault();
    showScorePreview();
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 2000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}