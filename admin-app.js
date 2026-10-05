/* ============================================================
 * 管理员页：本地解析 Excel → 预览 → 经 GitHub Contents API 发布
 * Token 仅存于本机浏览器 localStorage，不写入任何公开文件
 * ============================================================ */
const OWNER = 'ybh-best';
const REPO = 'rental-equipment-map';
const BRANCH = 'main';
const DATA_PATH = 'data/result.json';
const TOKEN_KEY = 'gh_pat_rental_equipment_map';

const $ = (id) => document.getElementById(id);
let DATA = null;       // 当前解析结果
let lastFile = null;
let ghUser = null;

const view = new DataView({
  tbody: $('salesTbody'),
  sumScissor: $('sumScissor'),
  sumBoom: $('sumBoom'),
  summaryRow: $('summaryRow'),
  select: null, // 管理员预览页不放下拉（整张图即全量预览）
  sub: $('tableSub'),
  map: $('mapChart'),
  mapTitle: $('mapTitle'),
  unknownCard: $('unknownCard'),
  unknownText: $('unknownText'),
  unknownSamples: $('unknownSamples'),
});
window.addEventListener('resize', () => view.resize());

/* ---------------- Token 管理 ---------------- */
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(v) { localStorage.setItem(TOKEN_KEY, v.trim()); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function verifyToken(token) {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Token 无效或已过期（${resp.status}）${t ? '：' + t.slice(0, 120) : ''}`);
  }
  return resp.json();
}

async function refreshTokenStatus() {
  const token = getToken();
  if (!token) {
    ghUser = null;
    $('tokenBtn').textContent = '设置 Token';
    $('tokenStatus').textContent = '未设置（发布前必须设置）';
    $('tokenStatus').className = 'step-status warn';
    updatePublishBtn();
    return;
  }
  $('tokenStatus').textContent = '验证中…';
  $('tokenStatus').className = 'step-status';
  try {
    ghUser = await verifyToken(token);
    $('tokenBtn').textContent = '更换 Token';
    $('tokenStatus').innerHTML = `✅ 已连接 <b>${ghUser.login}</b>`;
    $('tokenStatus').className = 'step-status ok';
  } catch (e) {
    ghUser = null;
    $('tokenBtn').textContent = '重新设置 Token';
    $('tokenStatus').textContent = '❌ ' + e.message;
    $('tokenStatus').className = 'step-status err';
  }
  updatePublishBtn();
}

$('tokenBtn').addEventListener('click', () => {
  $('tokenInput').value = getToken();
  $('tokenMsg').textContent = '';
  $('tokenModal').style.display = 'flex';
});
$('tokenCancel').addEventListener('click', () => { $('tokenModal').style.display = 'none'; });
$('tokenSave').addEventListener('click', async () => {
  const v = $('tokenInput').value.trim();
  if (!v) { $('tokenMsg').textContent = '请粘贴 Token'; $('tokenMsg').className = 'modal-msg err'; return; }
  $('tokenMsg').textContent = '正在验证…';
  $('tokenMsg').className = 'modal-msg';
  try {
    const u = await verifyToken(v);
    setToken(v);
    ghUser = u;
    $('tokenModal').style.display = 'none';
    refreshTokenStatus();
  } catch (e) {
    $('tokenMsg').textContent = e.message;
    $('tokenMsg').className = 'modal-msg err';
  }
});
$('tokenClear').addEventListener('click', () => {
  clearToken();
  $('tokenInput').value = '';
  $('tokenMsg').textContent = '已清除（保存关闭后生效）';
  $('tokenMsg').className = 'modal-msg warn';
  refreshTokenStatus();
});

/* ---------------- Excel 上传解析（本地） ---------------- */
$('fileInput').addEventListener('change', () => {
  if ($('fileInput').files.length) {
    lastFile = $('fileInput').files[0];
    parseFile(lastFile);
  }
});
$('rentedOnly').addEventListener('change', () => { if (lastFile) parseFile(lastFile); });

async function parseFile(file) {
  lastFile = file;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'xlsx' && ext !== 'xlsm') {
    alert('仅支持 .xlsx 格式文件，请将 .xls 另存为 .xlsx 后上传');
    return;
  }
  $('loadingText').textContent = '正在浏览器本地解析 Excel…';
  $('loading').style.display = 'flex';
  try {
    await loadRegions();
    const buffer = await file.arrayBuffer();
    DATA = analyzeWorkbook(buffer, file.name, $('rentedOnly').checked);
    await view.loadGeo();
    view.setData(DATA);
    let msg = `✅ 已解析：共 ${DATA.totalRows} 行，计入 ${DATA.countedRows} 台`;
    if (DATA.filteredOut > 0) msg += `（排除非在租 ${DATA.filteredOut} 台）`;
    msg += ` · 剪刀车 ${DATA.totals.scissor} / 臂车 ${DATA.totals.boom}，核对无误后请发布`;
    $('parseStatus').textContent = msg;
    $('parseStatus').className = 'step-status ok';
    $('tableSub').textContent = `共 ${DATA.salespeople.length} 位业务员 · 此为发布后访问者所见数据`;
  } catch (e) {
    DATA = null;
    $('parseStatus').textContent = '❌ ' + (e.message || '解析失败');
    $('parseStatus').className = 'step-status err';
  } finally {
    $('loading').style.display = 'none';
    updatePublishBtn();
  }
}

/* ---------------- 发布 ---------------- */
function updatePublishBtn() {
  $('publishBtn').disabled = !(DATA && ghUser);
  $('publishBtn').title = !DATA ? '请先上传并成功解析 Excel'
    : (!ghUser ? '请先设置并验证 GitHub Token' : '将当前预览数据发布到公网页面');
}

function b64Unicode(str) {
  return btoa(Array.from(new TextEncoder().encode(str), (b) => String.fromCharCode(b)).join(''));
}

async function githubApi(path, options = {}) {
  const resp = await fetch('https://api.github.com' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + getToken(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!resp.ok) {
    const msg = (body && body.message) ? body.message : ('HTTP ' + resp.status);
    throw new Error(msg + (body && body.errors ? ' ' + JSON.stringify(body.errors) : ''));
  }
  return body;
}

$('publishBtn').addEventListener('click', async () => {
  if (!DATA || !ghUser) return;
  if (!confirm('确认将当前预览数据发布到公网？\n发布后约 1 分钟，所有访问者打开网页将看到这份数据。')) return;

  const updatedAt = new Date().toISOString();
  const wrapper = {
    published: true,
    updatedAt,
    fileName: DATA.fileName,
    rentedOnly: DATA.rentedOnly,
    payload: DATA,
  };
  const content = b64Unicode(JSON.stringify(wrapper));

  $('publishBtn').disabled = true;
  $('publishStatus').textContent = '⏳ 正在提交到 GitHub…';
  $('publishStatus').className = 'step-status';
  try {
    // 获取现有文件 sha（更新必需；首次发布不存在则无 sha）
    let sha = null;
    try {
      const existing = await githubApi(`/repos/${OWNER}/${REPO}/contents/${DATA_PATH}?ref=${BRANCH}`);
      sha = existing.sha;
    } catch (e) {
      if (!/Not Found/i.test(e.message)) throw e;
    }

    await githubApi(`/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `发布在租数据 ${DATA.fileName} @ ${updatedAt.replace('T', ' ').slice(0, 16)}`,
        content,
        sha,
        branch: BRANCH,
      }),
    });
    $('publishStatus').innerHTML =
      `☁️ 已提交，等待 GitHub Pages 构建生效（通常 30~90 秒）…`;
    $('publishStatus').className = 'step-status ok';
    await waitLive(updatedAt);
  } catch (e) {
    $('publishStatus').textContent = '❌ 发布失败：' + e.message;
    $('publishStatus').className = 'step-status err';
    updatePublishBtn();
  }
});

async function waitLive(updatedAt) {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const resp = await fetch(`./data/result.json?t=${Date.now()}`, { cache: 'no-store' });
      if (resp.ok) {
        const live = await resp.json();
        if (live && live.updatedAt === updatedAt) {
          $('publishStatus').innerHTML =
            `🎉 已生效！访问者现在看到的就是这份数据。` +
            ` <a href="./index.html" target="_blank">打开访问者页面 →</a>`;
          $('publishStatus').className = 'step-status ok';
          updatePublishBtn();
          return;
        }
      }
    } catch (e) { /* 轮询中网络抖动忽略 */ }
    $('publishStatus').textContent = '☁️ 已提交，等待 Pages 生效中…（可稍候手动刷新访问页确认）';
  }
  $('publishStatus').innerHTML =
    `☁️ 已提交。Pages 构建可能稍慢，请 1~2 分钟后打开` +
    ` <a href="./index.html" target="_blank">访问者页面</a> 确认。`;
  $('publishStatus').className = 'step-status warn';
  updatePublishBtn();
}

/* ---------------- 初始化 ---------------- */
refreshTokenStatus();
