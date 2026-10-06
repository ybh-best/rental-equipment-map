/* ============================================================
 * 管理员页：本地解析 Excel → 预览 → 经 GitHub Contents API 发布
 * Token 仅存于本机浏览器 localStorage，不写入任何公开文件
 * v1.6.0 细节增强：
 *   · 整窗拖拽上传（含拖入高亮 / 类型拦截 / 弹层打开时屏蔽）
 *   · Token 显隐切换、Esc 关闭、Ctrl/⌘+Enter 保存
 *   · 自定义发布确认弹层（带数据摘要，替代原生 confirm）
 *   · 发布三阶段进度 + 等待秒数实时刷新 + 离开页面拦截
 *   · 解析显示文件大小 / 耗时；同一文件可重复选择
 *   · 今日密码跨午夜自动刷新；剪贴板降级时反馈真实结果
 *   · 网络错误与 401 区分提示；按钮防重复提交
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
let publishing = false;      // 发布进行中（锁定按钮 + 拦截离开）
let parsing = false;         // Excel 解析进行中（防止重复上传产生竞态）
let savingToken = false;
let lastCodeDay = RentalAccess.ymd(new Date());

/* ---------------- 通用小工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = type ? `step-status ${type}` : 'step-status';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function modalOpen(id) {
  return $(id) && $(id).style.display === 'flex';
}
function anyModalOpen() {
  return modalOpen('tokenModal') || modalOpen('confirmModal');
}

const view = new DataView({
  tbody: $('salesTbody'),
  sumScissor: $('sumScissor'),
  sumBoom: $('sumBoom'),
  summaryRow: $('summaryRow'),
  select: null, // 管理员预览页不放下拉（整张图即全量预览）
  sub: $('tableSub'),
  map: $('mapChart'),
  mapTitle: $('mapTitle'),
  placeholder: $('adminMapPlaceholder'),
  unknownCard: $('unknownCard'),
  unknownText: $('unknownText'),
  unknownSamples: $('unknownSamples'),
  regionSel: $('regionSel'),
  typeSel: $('typeSel'),
  sumCard: $('mapSumCard'),
});
window.addEventListener('resize', () => view.resize());

/* ---------------- 今日访问密码 ---------------- */
function refreshTodayCode() {
  const code = RentalAccess.today();
  $('todayCode').textContent = code;
  return code;
}
async function copyText(text, okMsg) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    // 剪贴板 API 不可用时的降级（非 HTTPS / 旧浏览器）
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (_) { ok = false; }
  }
  const el = $('copyStatus');
  if (ok) {
    setStatus(el, okMsg, 'ok');
  } else {
    setStatus(el, '❌ 复制失败，请手动选择文本复制', 'err');
  }
  setTimeout(() => { el.textContent = ''; el.className = 'step-status'; }, 2500);
}
$('copyCodeBtn').addEventListener('click', () => copyText(refreshTodayCode(), '✅ 今日密码已复制'));
$('copyLinkBtn').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname.replace(/admin\.html.*$/, '')}index.html?p=${refreshTodayCode()}`;
  copyText(url, '✅ 免输链接已复制（当天有效）');
});
refreshTodayCode();

// 跨午夜自动轮换今日密码
setInterval(() => {
  const today = RentalAccess.ymd(new Date());
  if (today !== lastCodeDay) {
    lastCodeDay = today;
    refreshTodayCode();
  }
}, 30 * 1000);

/* ---------------- Token 管理 ---------------- */
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(v) { localStorage.setItem(TOKEN_KEY, v.trim()); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function verifyToken(token) {
  let resp;
  try {
    resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (e) {
    throw new Error('网络错误，无法连接 GitHub，请检查网络后重试');
  }
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
    setStatus($('tokenStatus'), '未设置（发布前必须设置）', 'warn');
    updatePublishBtn();
    return;
  }
  setStatus($('tokenStatus'), '验证中…');
  try {
    ghUser = await verifyToken(token);
    $('tokenBtn').textContent = '更换 Token';
    const el = $('tokenStatus');
    el.innerHTML = `✅ 已连接 <b>${escHtml(ghUser.login)}</b>`;
    el.className = 'step-status ok';
  } catch (e) {
    ghUser = null;
    $('tokenBtn').textContent = '重新设置 Token';
    setStatus($('tokenStatus'), '❌ ' + e.message, 'err');
  }
  updatePublishBtn();
}

function openTokenModal() {
  $('tokenInput').value = getToken();
  $('tokenInput').type = 'password';
  $('tokenEye').textContent = '👁 显示';
  $('tokenMsg').textContent = '';
  $('tokenMsg').className = 'modal-msg';
  $('tokenModal').style.display = 'flex';
  setTimeout(() => $('tokenInput').focus(), 0);
}
function closeTokenModal() { $('tokenModal').style.display = 'none'; }

$('tokenBtn').addEventListener('click', openTokenModal);
$('tokenCancel').addEventListener('click', closeTokenModal);
$('tokenModal').addEventListener('click', (e) => {
  if (e.target === $('tokenModal')) closeTokenModal();
});
// 显示 / 隐藏 Token
$('tokenEye').addEventListener('click', () => {
  const input = $('tokenInput');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('tokenEye').textContent = show ? '🙈 隐藏' : '👁 显示';
});
$('tokenSave').addEventListener('click', async () => {
  if (savingToken) return;
  const v = $('tokenInput').value.trim();
  if (!v) {
    $('tokenMsg').textContent = '请粘贴 Token';
    $('tokenMsg').className = 'modal-msg err';
    return;
  }
  savingToken = true;
  $('tokenSave').disabled = true;
  $('tokenMsg').textContent = '正在验证…';
  $('tokenMsg').className = 'modal-msg';
  try {
    const u = await verifyToken(v);
    setToken(v);
    ghUser = u;
    closeTokenModal();
    refreshTokenStatus();
  } catch (e) {
    $('tokenMsg').textContent = e.message;
    $('tokenMsg').className = 'modal-msg err';
  } finally {
    savingToken = false;
    $('tokenSave').disabled = false;
  }
});
$('tokenClear').addEventListener('click', () => {
  clearToken();
  $('tokenInput').value = '';
  $('tokenMsg').textContent = '已清除（保存关闭后生效）';
  $('tokenMsg').className = 'modal-msg warn';
  refreshTokenStatus();
});

/* ---------------- 键盘快捷键（Esc 关闭弹层 / Ctrl+Enter 提交） ---------------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalOpen('confirmModal') && !publishing) closeConfirm(false);
    else if (modalOpen('tokenModal')) closeTokenModal();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (modalOpen('tokenModal')) {
      e.preventDefault();
      $('tokenSave').click();
    } else if (modalOpen('confirmModal')) {
      e.preventDefault();
      $('confirmOk').click();
    } else if (!$('publishBtn').disabled) {
      e.preventDefault();
      $('publishBtn').click();
    }
  }
});

/* ---------------- Excel 上传解析（本地） ---------------- */
$('fileInput').addEventListener('change', () => {
  const f = $('fileInput').files[0];
  if (f) parseFile(f);
  // 清空 value，保证同一文件可以再次选择触发解析
  $('fileInput').value = '';
});
$('rentedOnly').addEventListener('change', () => { if (lastFile) parseFile(lastFile); });

/* 整窗拖拽上传 */
let dragDepth = 0;
function isFileDrag(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e) || anyModalOpen() || publishing || parsing) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  // 拖出窗口时 relatedTarget 为 null，直接复位，避免计数器卡死高亮
  if (e.relatedTarget === null) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  } else {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dragging');
  }
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (anyModalOpen() || publishing || parsing) return;
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) parseFile(f);
});

async function parseFile(file) {
  if (parsing) return;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'xlsx' && ext !== 'xlsm') {
    alert('仅支持 .xlsx 格式文件，请将 .xls 另存为 .xlsx 后上传');
    return;
  }
  lastFile = file;
  $('loadingText').textContent = '正在浏览器本地解析 Excel…';
  $('loading').style.display = 'flex';
  parsing = true;
  const t0 = performance.now();
  try {
    await loadRegions();
    const buffer = await file.arrayBuffer();
    DATA = analyzeWorkbook(buffer, file.name, $('rentedOnly').checked);
    await view.loadGeo();
    view.setData(DATA);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    let msg = `✅ 已解析：${escHtml(file.name)}（${formatSize(file.size)}，耗时 ${secs}s）`
            + ` · 共 ${DATA.totalRows} 行，计入 ${DATA.countedRows} 台`;
    if (DATA.filteredOut > 0) msg += `（排除非在租 ${DATA.filteredOut} 台）`;
    msg += ` · 剪刀车 ${DATA.totals.scissor} / 臂车 ${DATA.totals.boom}，核对无误后请发布`;
    if (DATA.guessedRows > 0) msg += `（🔎 ${DATA.guessedRows} 台无定位，已按「位置」列关键词联想归区）`;
    if (DATA.unknownCount > 0) msg += `（⚠️ ${DATA.unknownCount} 台未识别区域）`;
    const el = $('parseStatus');
    el.innerHTML = msg;
    el.className = 'step-status ok';
    $('tableSub').textContent = `共 ${DATA.salespeople.length} 位业务员 · 此为发布后访问者所见数据`;
  } catch (e) {
    DATA = null;
    setStatus($('parseStatus'), '❌ ' + (e.message || '解析失败'), 'err');
  } finally {
    parsing = false;
    $('loading').style.display = 'none';
    updatePublishBtn();
  }
}

/* ---------------- 发布 ---------------- */
function updatePublishBtn() {
  const btn = $('publishBtn');
  btn.disabled = publishing || !(DATA && ghUser);
  if (DATA) {
    btn.textContent = publishing ? '⏳ 发布中…' : `🚀 发布（${DATA.countedRows} 台）`;
  } else {
    btn.textContent = '🚀 发布到网站';
  }
  btn.title = !DATA ? '请先上传并成功解析 Excel'
    : (!ghUser ? '请先设置并验证 GitHub Token' : '将当前预览数据发布到公网页面（Ctrl+Enter）');
}

function onBeforeUnload(e) {
  if (!publishing) return;
  e.preventDefault();
  e.returnValue = '数据发布正在进行中，确定离开本页吗？';
}

function b64Unicode(str) {
  return btoa(Array.from(new TextEncoder().encode(str), (b) => String.fromCharCode(b)).join(''));
}

async function githubApi(path, options = {}) {
  let resp;
  try {
    resp = await fetch('https://api.github.com' + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + getToken(),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    throw new Error('网络错误，无法连接 GitHub，请检查网络后重试');
  }
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!resp.ok) {
    const msg = (body && body.message) ? body.message : ('HTTP ' + resp.status);
    throw new Error(msg + (body && body.errors ? ' ' + JSON.stringify(body.errors) : ''));
  }
  return body;
}

/* 自定义确认弹层：Promise<boolean> */
let confirmResolve = null;
function openConfirm(items) {
  $('confirmSummary').innerHTML = items.map((i) => `<li>${i}</li>`).join('');
  $('confirmModal').style.display = 'flex';
  setTimeout(() => $('confirmOk').focus(), 0);
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(ok) {
  $('confirmModal').style.display = 'none';
  if (confirmResolve) {
    const r = confirmResolve;
    confirmResolve = null;
    r(ok);
  }
}
$('confirmOk').addEventListener('click', () => closeConfirm(true));
$('confirmCancel').addEventListener('click', () => closeConfirm(false));
$('confirmModal').addEventListener('click', (e) => {
  if (e.target === $('confirmModal') && !publishing) closeConfirm(false);
});

$('publishBtn').addEventListener('click', async () => {
  if (!DATA || !ghUser || publishing) return;

  const items = [
    `数据文件：<b>${escHtml(DATA.fileName)}</b>`,
    `计入设备：<b>${DATA.countedRows}</b> 台（剪刀车 ${DATA.totals.scissor} / 臂车 ${DATA.totals.boom}）`,
    `统计口径：<b>${DATA.rentedOnly ? '仅在租' : '全部状态'}</b> · 业务员 ${DATA.salespeople.length} 位`,
  ];
  if (DATA.guessedRows > 0) {
    items.push(`<span class="warn-text">🔎 ${DATA.guessedRows} 台无GPS定位，已按「位置」列关键词联想归区（如"汉阳仓"→汉阳区域）</span>`);
  }
  if (DATA.unknownCount > 0) {
    items.push(`<span class="warn-text">⚠️ 未识别区域 ${DATA.unknownCount} 台（不计入地图，发布前请确认）</span>`);
  }
  const ok = await openConfirm(items);
  if (!ok) return;
  doPublish();
});

async function doPublish() {
  publishing = true;
  document.body.classList.add('is-publishing');
  updatePublishBtn();
  window.addEventListener('beforeunload', onBeforeUnload);

  const updatedAt = new Date().toISOString();
  const wrapper = {
    published: true,
    updatedAt,
    fileName: DATA.fileName,
    rentedOnly: DATA.rentedOnly,
    payload: DATA,
  };
  const content = b64Unicode(JSON.stringify(wrapper));

  try {
    // [1/3] 获取现有文件 sha（更新必需；首次发布不存在则无 sha）
    setStatus($('publishStatus'), '⏳ [1/3] 正在校验线上文件版本…');
    let sha = null;
    try {
      const existing = await githubApi(`/repos/${OWNER}/${REPO}/contents/${DATA_PATH}?ref=${BRANCH}`);
      sha = existing.sha;
    } catch (e) {
      if (!/Not Found/i.test(e.message)) throw e;
    }

    // [2/3] 提交
    setStatus($('publishStatus'), '⏳ [2/3] 正在提交到 GitHub…');
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

    // [3/3] 等待 Pages 生效
    await waitLive(updatedAt);
  } catch (e) {
    setStatus($('publishStatus'), '❌ 发布失败：' + e.message, 'err');
  } finally {
    publishing = false;
    document.body.classList.remove('is-publishing');
    window.removeEventListener('beforeunload', onBeforeUnload);
    updatePublishBtn();
  }
}

async function waitLive(updatedAt) {
  const deadline = Date.now() + 3 * 60 * 1000;
  const started = Date.now();
  const tick = () => {
    const s = Math.round((Date.now() - started) / 1000);
    setStatus($('publishStatus'), `⏳ [3/3] 已提交，等待 Pages 生效… 已等待 ${s} 秒（通常 30~90 秒）`);
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    while (Date.now() < deadline) {
      await sleep(8000);
      try {
        const resp = await fetch(`./data/result.json?t=${Date.now()}`, { cache: 'no-store' });
        if (resp.ok) {
          const live = await resp.json();
          if (live && live.updatedAt === updatedAt) {
            $('publishStatus').innerHTML =
              `🎉 已生效（耗时 ${Math.round((Date.now() - started) / 1000)} 秒）！访问者现在看到的就是这份数据。` +
              ` <a href="./index.html" target="_blank">打开访问者页面 →</a>`;
            $('publishStatus').className = 'step-status ok';
            return;
          }
        }
      } catch (e) { /* 轮询中网络抖动忽略 */ }
    }
    $('publishStatus').innerHTML =
      `☁️ 已提交。Pages 构建可能稍慢，请 1~2 分钟后打开` +
      ` <a href="./index.html" target="_blank">访问者页面</a> 确认。`;
    $('publishStatus').className = 'step-status warn';
  } finally {
    clearInterval(timer);
  }
}

/* ---------------- 初始化 ---------------- */
refreshTokenStatus();
updatePublishBtn();
