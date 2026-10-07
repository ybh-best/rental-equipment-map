/* 访问者页入口：密码门 + 只读拉取管理员已发布的数据（data/result.json），无任何上传能力 */
const $ = (id) => document.getElementById(id);

const view = new DataView({
  tbody: $('salesTbody'),
  sumScissor: $('sumScissor'),
  sumBoom: $('sumBoom'),
  summaryRow: $('summaryRow'),
  select: $('salesSelect'),
  sub: $('tableSub'),
  map: $('mapChart'),
  mapTitle: $('mapTitle'),
  placeholder: $('mapPlaceholder'),
  regionSel: $('regionSel'),
  typeSel: $('typeSel'),
  sumCard: $('mapSumCard'),
});

window.addEventListener('resize', () => view.resize());

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) { return iso || ''; }
}

function showEmpty(message) {
  const tbody = $('salesTbody');
  if (tbody) tbody.innerHTML = `<tr class="empty-row"><td colspan="3">${message}</td></tr>`;
  const sum = $('summaryRow');
  if (sum) sum.style.display = 'none';
  const sel = $('salesSelect');
  if (sel) sel.disabled = true;
  const phText = $('placeholderText');
  if (phText) phText.textContent = message;
  const ph = $('mapPlaceholder');
  if (ph) ph.style.display = '';
  const info = $('publishInfo');
  if (info) info.textContent = '';
}

async function loadPublished() {
  $('fileInfo').textContent = '正在加载数据…';
  try {
    // github.io 卡住时 4 秒超时，自动逐级切换国内镜像（见 view.js fetchWithMirrors）
    const resp = await fetchWithMirrors('./data/result.json?t=' + Date.now(), 'data/result.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();

    if (!json || !json.published || !json.payload) {
      showEmpty('数据尚未发布，请等待管理员上传最新在租情况 Excel');
      $('fileInfo').textContent = '暂无已发布数据';
      return;
    }

    const d = json.payload;
    await view.loadGeo();
    view.setData(d);
    $('mapPlaceholder').style.display = 'none';

    let msg = `📊 ${json.fileName || '已发布数据'} · 共 ${d.totalRows} 行，计入 ${d.countedRows} 台`;
    if (d.filteredOut > 0) msg += `（已排除非在租 ${d.filteredOut} 台）`;
    $('fileInfo').textContent = msg;
    $('tableSub').textContent = `共 ${d.salespeople.length} 位业务员 · 单击行筛选 · 双击回汇总 · 点表头排序`;
    $('publishInfo').textContent = `数据更新于 ${fmtTime(json.updatedAt)}（剪刀车 ${d.totals.scissor} 台 / 臂车 ${d.totals.boom} 台）`;
  } catch (e) {
    if (String(e.message).includes('404')) {
      showEmpty('数据尚未发布，请等待管理员上传最新在租情况 Excel');
      $('fileInfo').textContent = '暂无已发布数据';
    } else {
      showEmpty('数据加载失败，请点击“刷新数据”重试');
      $('fileInfo').textContent = '加载失败：' + e.message;
    }
  }
}

$('refreshBtn').addEventListener('click', loadPublished);

/* ---------------- 每日动态密码门 ---------------- */
let started = false;
function start() {
  if (started) return;
  started = true;
  $('gateMask').style.display = 'none';
  loadPublished();
}
function codeOk(v) {
  return String(v || '').trim() === RentalAccess.today();
}
function grant(v) {
  sessionStorage.setItem(RentalAccess.AUTH_KEY, RentalAccess.today());
  $('gateMask').style.display = 'none';
  start();
}
$('gateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('gateInput').value;
  if (codeOk(v)) {
    grant(v);
  } else {
    $('gateErr').textContent = '密码不正确，请向管理员确认今天的 6 位密码';
    $('gateInput').value = '';
    $('gateInput').focus();
  }
});

// 支持带密码直链 index.html?p=123456（管理员可直接复制链接发给访问者）
const urlCode = new URLSearchParams(location.search).get('p');
if (urlCode && codeOk(urlCode)) {
  grant(urlCode);
} else if (sessionStorage.getItem(RentalAccess.AUTH_KEY) === RentalAccess.today()) {
  // 同一标签会话内已输过今日密码，不再重复询问
  start();
} else {
  $('gateMask').style.display = 'flex';
  $('gateInput').focus();
}
