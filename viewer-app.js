/* 访问者页入口：只读拉取管理员已发布的数据（data/result.json），无任何上传能力 */
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
  unknownCard: $('unknownCard'),
  unknownText: $('unknownText'),
  unknownSamples: $('unknownSamples'),
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
  const card = $('unknownCard');
  if (card) card.style.display = 'none';
  const info = $('publishInfo');
  if (info) info.textContent = '';
}

async function loadPublished() {
  $('fileInfo').textContent = '正在加载数据…';
  try {
    const resp = await fetch('./data/result.json?t=' + Date.now(), { cache: 'no-store' });
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
    $('tableSub').textContent = `共 ${d.salespeople.length} 位业务员 · 点击行可筛选地图`;
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
loadPublished();
