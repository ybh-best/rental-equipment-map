/* 门店在租设备分布图 - 前端逻辑（纯静态版，Excel 在浏览器本地解析） */
let DATA = null;
let currentSales = '__ALL__';
let chart = null;
let lastFile = null;

const $ = (id) => document.getElementById(id);

/* ---------- 上传 ---------- */
$('fileInput').addEventListener('change', () => {
  if ($('fileInput').files.length > 0) {
    lastFile = $('fileInput').files[0];
    handleFile(lastFile);
  }
});

$('rentedOnly').addEventListener('change', () => {
  if (lastFile) handleFile(lastFile);
});

async function handleFile(file) {
  lastFile = file;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'xlsx' && ext !== 'xlsm') {
    alert('仅支持 .xlsx 格式文件，请将 .xls 另存为 .xlsx 后上传');
    return;
  }
  $('loading').style.display = 'flex';
  try {
    await loadRegions();
    const buffer = await file.arrayBuffer();
    const json = analyzeWorkbook(buffer, file.name, $('rentedOnly').checked);
    DATA = json;
    currentSales = '__ALL__';
    renderAll();
  } catch (e) {
    alert(e.message || '解析失败，请检查文件格式');
  } finally {
    $('loading').style.display = 'none';
  }
}

/* ---------- 渲染总入口 ---------- */
function renderAll() {
  renderInfo();
  renderSelect();
  renderTable();
  renderUnknown();
  renderMap();
}

function renderInfo() {
  const f = DATA.fileName || '';
  let msg = `📊 ${f.length > 42 ? f.slice(0, 42) + '…' : f}　共 ${DATA.totalRows} 行，计入 ${DATA.countedRows} 台`;
  if (DATA.filteredOut > 0) msg += `（已排除非在租 ${DATA.filteredOut} 台）`;
  if (!DATA.hasRentInfo) msg += '（表格无租赁状态/占用单据列，按全部数据统计）';
  $('fileInfo').textContent = msg;
  $('tableSub').textContent = `共 ${DATA.salespeople.length} 位业务员 · 点击行可筛选地图`;
}

/* ---------- 业务员下拉 ---------- */
function renderSelect() {
  const sel = $('salesSelect');
  sel.innerHTML = '<option value="__ALL__">全部数据（汇总）</option>';
  DATA.salespeople.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = `${s.name}（剪${s.scissor} / 臂${s.boom}）`;
    sel.appendChild(opt);
  });
  sel.value = currentSales;
  sel.disabled = false;
}

$('salesSelect').addEventListener('change', () => {
  currentSales = $('salesSelect').value;
  renderTable();
  renderUnknown();
  renderMap();
});

/* ---------- 左侧表格 ---------- */
function renderTable() {
  const tbody = $('salesTbody');
  tbody.innerHTML = '';
  DATA.salespeople.forEach((s) => {
    const tr = document.createElement('tr');
    if (s.name === currentSales) tr.className = 'active';
    tr.innerHTML =
      `<td class="col-name">${escapeHtml(s.name)}</td>` +
      `<td class="col-num">${s.scissor}</td>` +
      `<td class="col-num">${s.boom}</td>`;
    tr.addEventListener('click', () => {
      currentSales = s.name;
      $('salesSelect').value = s.name;
      renderTable();
      renderUnknown();
      renderMap();
    });
    tbody.appendChild(tr);
  });

  $('sumScissor').textContent = DATA.totals.scissor;
  $('sumBoom').textContent = DATA.totals.boom;
  $('summaryRow').style.display = '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------- 未识别区域提示 ---------- */
function getRegionView(regionName) {
  const r = DATA.regions.find((x) => x.name === regionName);
  if (!r) return { scissor: 0, boom: 0, total: 0 };
  if (currentSales === '__ALL__') {
    return { scissor: r.scissor, boom: r.boom, total: r.total };
  }
  const v = r.sales.find((x) => x.name === currentSales);
  return v ? { scissor: v.scissor, boom: v.boom, total: v.scissor + v.boom }
           : { scissor: 0, boom: 0, total: 0 };
}

function renderUnknown() {
  const v = getRegionView(UNKNOWN_REGION);
  const card = $('unknownCard');
  if (v.total > 0) {
    card.style.display = '';
    const who = currentSales === '__ALL__' ? '全部' : currentSales;
    $('unknownText').textContent = `${who} 有 ${v.total} 台设备（剪刀车 ${v.scissor} 台、臂车 ${v.boom} 台）无法定位到湖北区域，未显示在地图上。`;
    if (currentSales === '__ALL__' && DATA.unknownSamples.length) {
      $('unknownSamples').innerHTML = '地址样例：' +
        DATA.unknownSamples.map(escapeHtml).join('<br>');
    } else {
      $('unknownSamples').innerHTML = '';
    }
  } else {
    card.style.display = 'none';
  }
}

/* ---------- 地图 ---------- */
async function renderMap() {
  if (!DATA) return;
  if (!chart) chart = echarts.init($('mapChart'));
  const geo = await loadRegions();
  echarts.registerMap('hubei', geo);

  const mapData = DATA.regions
    .filter((r) => r.name !== UNKNOWN_REGION)
    .map((r) => {
      const v = getRegionView(r.name);
      return { name: r.name, value: v.total, scissor: v.scissor, boom: v.boom };
    });

  const maxVal = Math.max(1, ...mapData.map((d) => d.value));
  const title = currentSales === '__ALL__'
    ? '湖北省在租设备分布（全部数据）'
    : `${currentSales} 的在租设备分布`;
  $('mapTitle').textContent = title;

  chart.setOption({
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15, 35, 80, .92)',
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 13 },
      formatter: (p) => {
        const d = p.data || {};
        const s = d.scissor || 0, b = d.boom || 0, t = d.value || 0;
        if (t === 0) return `<b>${p.name}</b><br/>暂无在租设备`;
        return `<b style="font-size:14px">${p.name}</b><br/>` +
               `剪刀车：<b style="color:#7dd3fc">${s}</b> 台<br/>` +
               `臂　车：<b style="color:#fdba74">${b}</b> 台<br/>` +
               `合　计：<b>${t}</b> 台`;
      },
    },
    visualMap: {
      type: 'continuous',
      min: 0,
      max: maxVal,
      left: 16,
      bottom: 18,
      text: ['多', '少'],
      calculable: true,
      inRange: { color: ['#e3edfb', '#7fb0f5', '#2563eb', '#173b8e'] },
      outOfRange: { color: '#f1f5f9' },
      textStyle: { color: '#475569', fontSize: 12 },
    },
    series: [{
      name: '在租设备',
      type: 'map',
      map: 'hubei',
      roam: true,
      zoom: 1.05,
      layoutCenter: ['50%', '52%'],
      layoutSize: '96%',
      selectedMode: false,
      label: {
        show: true,
        formatter: (p) => {
          const d = p.data || {};
          const s = d.scissor || 0, b = d.boom || 0;
          if ((d.value || 0) > 0) {
            return `{n|${p.name}}\n{c|剪${s}} {b|臂${b}}`;
          }
          return `{n|${p.name}}`;
        },
        rich: {
          n: { color: '#334155', fontSize: 11, fontWeight: 600, lineHeight: 15 },
          c: { color: '#1d4ed8', fontSize: 10, lineHeight: 14 },
          b: { color: '#c2410c', fontSize: 10, lineHeight: 14 },
        },
      },
      emphasis: {
        label: {
          show: true,
          rich: {
            n: { color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 18 },
            c: { color: '#bfdbfe', fontSize: 12, lineHeight: 16 },
            b: { color: '#fed7aa', fontSize: 12, lineHeight: 16 },
          },
        },
        itemStyle: { areaColor: '#f59e0b', shadowBlur: 14, shadowColor: 'rgba(0,0,0,.3)' },
      },
      itemStyle: {
        borderColor: '#ffffff',
        borderWidth: 1,
        areaColor: '#f1f5f9',
      },
      data: mapData,
    }],
  }, true);
}

window.addEventListener('resize', () => {
  if (chart) chart.resize();
});
